import { z } from 'zod';
import { clip } from '../engine/rules/evidence';
import type { ScanRecord } from '../quarantine/registry';
import { CONFIRM, LEVEL_LABEL, type ActionName } from './copy';
import { safeRelPath } from './paths';
import { buttonsFor, requiresConfirm, topFinding } from './view';

const SCAN_ID = /^[0-9a-f]{64}$/;
const COUNT = z.number().int().min(0).max(1_000_000);

// Webview → host. Closed and strict: unknown types, unknown actions, extra keys and wrong types are all rejected (I-12).
const MessageSchema = z.union([
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({ type: z.literal('action'), scanId: z.string().regex(SCAN_ID), action: z.enum(['openNeutralized', 'open', 'delete', 'copyReport']) }),
  z.strictObject({ type: z.literal('action'), scanId: z.string().regex(SCAN_ID), action: z.literal('viewFile'), file: z.string().min(1).max(1000) }),
  // What is on screen, reported by the webview's own code after it renders. Lets the host (and tests) see that
  // repo text became text and not elements. It carries no authority: nothing acts on it.
  z.strictObject({ type: z.literal('rendered'), scanId: z.string().regex(SCAN_ID), images: COUNT, scripts: COUNT, anchors: COUNT, injected: z.boolean(), text: z.string().max(20_000) }),
]);

export type WebviewMessage = z.infer<typeof MessageSchema>;
export type WebviewAction = Extract<WebviewMessage, { type: 'action' }>;
export type RenderedStats = Omit<Extract<WebviewMessage, { type: 'rendered' }>, 'type' | 'scanId'>;

export function parseWebviewMessage(raw: unknown): WebviewMessage | null {
  const r = MessageSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export interface ActionHandlers {
  openNeutralized(rec: ScanRecord): void | Promise<void>;
  open(rec: ScanRecord): void | Promise<void>;
  delete(rec: ScanRecord): void | Promise<void>;
  viewFile(rec: ScanRecord, file: string): void | Promise<void>;
  copyReport(rec: ScanRecord): void | Promise<void>;
}

export interface BridgeDeps {
  rec: ScanRecord;
  handlers: ActionHandlers;
  ui: { confirm(title: string, detail: string, okLabel: string): Promise<boolean> };
  /** True while the registry still holds this exact verdict (same commit and content hash). I-2. */
  isRecorded(): boolean;
  onReady(): void;
  onRendered?(stats: RenderedStats): void;
}

export type BridgeResult = { handled: true } | { handled: false; reason: string };

const OPENING: ReadonlySet<ActionName> = new Set(['open', 'openNeutralized']);

export function createBridge(deps: BridgeDeps): { handle(raw: unknown): Promise<BridgeResult> } {
  const { rec } = deps;
  const level = rec.verdict.level;
  const allowed = new Set<ActionName>([...buttonsFor(level), 'viewFile', 'copyReport']);
  let confirming = false;
  const drop = (reason: string): BridgeResult => ({ handled: false, reason });

  return {
    async handle(raw) {
      const msg = parseWebviewMessage(raw);
      if (!msg) return drop('invalid message');

      if (msg.type === 'ready') {
        deps.onReady();
        return { handled: true };
      }
      if (msg.scanId !== rec.scanId) return drop('wrong scan');
      if (msg.type === 'rendered') {
        const { type: _t, scanId: _s, ...stats } = msg;
        deps.onRendered?.(stats);
        return { handled: true };
      }

      // The host decides what is allowed; it never relies on the webview having hidden a button.
      if (!allowed.has(msg.action)) return drop('not allowed');
      let file: string | undefined;
      if (msg.action === 'viewFile') {
        file = safeRelPath(msg.file) ?? undefined;
        if (file === undefined) return drop('bad path');
      }
      // I-2: no way to open until a verdict for this exact clone is on record.
      if (OPENING.has(msg.action) && !deps.isRecorded()) return drop('not recorded');

      if (requiresConfirm(level, msg.action)) {
        if (confirming) return drop('busy');
        confirming = true;
        try {
          const repo = clip(rec.verdict.target.id, 120);
          const top = topFinding(rec);
          const where = top ? `Top finding: ${clip(top.title, 140)}${top.location ? ` (${clip(top.location.file, 100)}${top.location.line ? `:${top.location.line}` : ''})` : ''}.` : '';
          const neutralized = msg.action === 'openNeutralized';
          const ok = await deps.ui.confirm(
            neutralized ? CONFIRM.neutralizedTitle(repo) : CONFIRM.openTitle(repo),
            (neutralized ? CONFIRM.neutralizedDetail : CONFIRM.openDetail)(LEVEL_LABEL[level], where),
            neutralized ? CONFIRM.neutralizedButton : CONFIRM.openButton,
          );
          if (!ok) return drop('cancelled');
        } finally {
          confirming = false;
        }
      }

      try {
        if (msg.action === 'viewFile') await deps.handlers.viewFile(rec, file!);
        else await deps.handlers[msg.action](rec);
        return { handled: true };
      } catch {
        return drop('handler failed');
      }
    },
  };
}
