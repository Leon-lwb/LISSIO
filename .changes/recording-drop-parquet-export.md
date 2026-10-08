---
"lissio": minor:removed
---

Removed the Parquet export format for recorded data. Parquet was reachable only
through the DuckDB engine's `COPY … (FORMAT PARQUET)`, and DuckDB is being
replaced, so the export dialog now offers CSV and JSON only. A request that still
asks for `format: "parquet"` is rejected as an invalid export request.
