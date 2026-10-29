import { describe, expect, test } from 'vitest';
import { validateRepoUrl } from '../../src/quarantine/paths';

const ok = (input: string) => validateRepoUrl(input);
const cyrillicO = String.fromCharCode(0x043e);
const nl = String.fromCharCode(10);
const nul = String.fromCharCode(0);

describe('validateRepoUrl: common pasted forms normalize (Review Focus 1)', () => {
  test.each([
    'https://github.com/octo/hello',
    'https://github.com/octo/hello/',
    'https://github.com/octo/hello.git',
    'https://github.com/octo/hello.git/',
    'http://github.com/octo/hello',
    'github.com/octo/hello',
    'www.github.com/octo/hello',
    'https://www.github.com/octo/hello',
    'https://github.com/octo/hello/tree/main',
    'https://github.com/octo/hello/tree/feature/x/y',
    'https://github.com/octo/hello/blob/main/README.md',
    'https://github.com/octo/hello/pull/12',
    'https://github.com/octo/hello/issues',
    'https://github.com/octo/hello?tab=readme-ov-file',
    'https://github.com/octo/hello#readme',
    'git@github.com:octo/hello.git',
    'git@github.com:octo/hello',
    'ssh://git@github.com/octo/hello.git',
    '  https://github.com/octo/hello  ',
    'HTTPS://GitHub.com/octo/hello',
  ])('%j → https://github.com/octo/hello', (input) => {
    expect(ok(input)).toEqual({ owner: 'octo', repo: 'hello', url: 'https://github.com/octo/hello' });
  });
  test('owner/repo characters are kept', () => {
    expect(ok('https://github.com/Open-Source/my.repo_v2-x')).toEqual({ owner: 'Open-Source', repo: 'my.repo_v2-x', url: 'https://github.com/Open-Source/my.repo_v2-x' });
  });
  test('a repo literally named like "x.github.io" is fine', () => {
    expect(ok('https://github.com/octo/octo.github.io')).toMatchObject({ repo: 'octo.github.io' });
  });
});

describe('validateRepoUrl: everything else is a clear error, never a silent pass-through', () => {
  const hostile: [string, string][] = [
    ['option injection', '--upload-pack=touch /tmp/pwned'],
    ['option injection with a url', '--config=x https://github.com/o/r'],
    ['ext transport', 'ext::sh -c touch% /tmp/pwned'],
    ['file url', 'file:///etc/passwd'],
    ['local path', '/home/me/repo'],
    ['relative path', '../repo'],
    ['another host', 'https://gitlab.com/o/r'],
    ['github as a path on another host', 'https://evil.example/github.com/o/r'],
    ['github as a subdomain prefix', 'https://github.com.evil.example/o/r'],
    ['userinfo trick', 'https://github.com@evil.example/o/r'],
    ['credentials in the url', 'https://user:token@github.com/o/r'],
    ['a port', 'https://github.com:8443/o/r'],
    ['gist subdomain', 'https://gist.github.com/o/r'],
    ['raw host', 'https://raw.githubusercontent.com/o/r/main/x'],
    ['dot-dot in the path', 'https://github.com/o/../r'],
    ['dot-dot repo', 'https://github.com/o/..'],
    ['single dot repo', 'https://github.com/o/.'],
    ['dot-dot later', 'https://github.com/o/r/tree/../../x'],
    ['leading dash owner', 'https://github.com/-o/r'],
    ['leading dash repo', 'https://github.com/o/-r'],
    ['percent encoding', 'https://github.com/o/%2e%2e'],
    ['percent encoded slash', 'https://github.com/o%2fx/r'],
    ['no repo', 'https://github.com/octo'],
    ['no owner', 'https://github.com/'],
    ['not a repo page', 'https://github.com/o/r/archive/main.zip'],
    ['unknown subpath', 'https://github.com/o/r/evil'],
    ['empty', ''],
    ['whitespace only', '   '],
    ['scp form for another host', 'git@evil.example:o/r.git'],
    ['ssh with another user', 'ssh://root@github.com/o/r'],
    ['javascript url', 'javascript:alert(1)'],
    ['embedded newline', `https://github.com/o/r${nl}--upload-pack=x`],
    ['embedded space', 'https://github.com/o/r --upload-pack=x'],
    ['embedded NUL', `https://github.com/o/r${nul}`],
    ['two urls', 'https://github.com/o/r https://github.com/a/b'],
    ['non-ASCII look-alike owner', `https://github.com/${cyrillicO}/r`],
    ['owner too long', `https://github.com/${'a'.repeat(40)}/r`],
    ['repo too long', `https://github.com/o/${'a'.repeat(101)}`],
    ['input too long', `https://github.com/o/r/tree/${'a'.repeat(400)}`],
    ['repo ending in a second .git', 'https://github.com/o/r.git.git'],
  ];
  test.each(hostile)('%s', (_name, input) => {
    const r = validateRepoUrl(input);
    expect(r).toHaveProperty('error');
    expect((r as { error: string }).error.length).toBeGreaterThan(10);
  });
  test('the error says what is supported', () => {
    expect((validateRepoUrl('https://gitlab.com/o/r') as { error: string }).error).toMatch(/github\.com\/owner\/repo/);
  });
  test('every accepted result matches the strict clone-URL regex', () => {
    const STRICT = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(\.git)?\/?$/;
    for (const input of ['github.com/a/b', 'git@github.com:a-b/c.d.git', 'https://github.com/a/b/tree/main']) {
      const r = validateRepoUrl(input);
      expect('url' in r && STRICT.test(r.url)).toBe(true);
    }
  });
});
