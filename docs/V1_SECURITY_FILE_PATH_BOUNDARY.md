# V1 Security File / Path Boundary

Status: **CERTIFICATION CONTRACT**

## HTTP runtime rule

V1 HTTP handlers must not turn caller-controlled request fields, upload filenames, or multipart temporary paths into filesystem or process-execution paths.

- purchase invoice upload is admin-only, memory-only, capped at 5 MB and content-signature verified before parser/OCR work;
- product import file admission is bounded and verifies supported content before parser execution;
- HTTP runtime must not introduce `multer.diskStorage`, `req.file.path`, direct request-controlled filesystem paths, or request-controlled `exec`/`spawn` arguments;
- caller-provided filenames are descriptive metadata only and are never trusted as server execution/storage locations.

## Operator recovery exception

Native PostgreSQL backup/restore is an **operator-only** recovery mechanism, not an HTTP upload or download path. Database Quality V1 separately requires verified archive/manifest/checksum, explicit **same-tenant** binding and confirmation, and transactional restore. Those operator-supplied local paths are outside tenant/browser/POS HTTP authority and must not be exposed as request-controlled server paths.

## Change rule

Any new HTTP filesystem upload/download, disk-backed multipart storage, archive extraction, caller-controlled path, or process execution surface requires a new Security review and focused acceptance before V1 authority can be widened.
