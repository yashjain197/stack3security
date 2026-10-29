"""
Base Pydantic model for every request and response: camelCase JSON, strict about unknown fields.

Made by Yash Jain with passion.
"""

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class ApiModel(BaseModel):
    """camelCase on the wire, snake_case in Python, unknown request fields rejected."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        str_strip_whitespace=True,
        from_attributes=True,
    )
