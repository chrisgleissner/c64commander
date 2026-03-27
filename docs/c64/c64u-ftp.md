# C64 Ultimate FTP service (implemented feature set)

## How FTP is exposed

- The firmware runs an FTP daemon that listens on TCP port 21 when the FTP service is enabled in network settings (CFG_NETWORK_FTP_SERVICE).
- Each connection is a separate task, with data transfers using active (PORT) or passive (PASV) data connections.

## Authentication

- `USER` accepts any name (it is only used to toggle listing mode).
- `PASS` is checked against the Network Password (CFG_NETWORK_PASSWORD). If the Network Password is empty, any password is accepted.

## Implemented commands (control channel)

- Session: `USER`, `PASS`, `QUIT`, `NOOP`, `SYST`, `FEAT`
- Navigation: `PWD`, `XPWD`, `CWD`, `CDUP`
- Listings: `LIST`, `NLST`, `MLST`, `MLSD`
- Transfer: `RETR` (read), `STOR` (write)
- File/dir management: `MKD`/`XMKD`, `RMD`/`XRMD`, `DELE`, `RNFR` + `RNTO`
- Data connection: `PORT`, `PASV`, `ABOR`
- Metadata: `SIZE`

## Listing a folder and detecting files vs. directories

- Recommended: use `MLSD` for a machine-readable listing. Each entry includes `type=dir` or `type=file` and `size=...`, plus `modify=YYYYMMDDhhmmss`.
- Single item: use `MLST <path>` to query one item with `type=dir` or `type=file`.
- Human-readable fallback: `LIST` uses a Unix-like line that starts with `d` for directories and `-` for files.
- Names-only: `NLST` returns only names (no type info).

## Reading and writing files

- Read a file: `RETR <path>` (opens a data connection and streams the file).
- Write/overwrite a file: `STOR <path>` (opens a data connection and writes incoming data). A zero-length `STOR` effectively creates an empty file.

## Creating and deleting files/folders

- Create folder: `MKD <path>` (also `XMKD`).
- Delete folder: `RMD <path>` (also `XRMD`).
- Delete file: `DELE <path>`.
- Rename/move: `RNFR <old>` followed by `RNTO <new>`.

## Notes

- A data connection must be established via `PORT` or `PASV` before `LIST`/`NLST`/`MLSD`/`RETR`/`STOR`.
- `TYPE` is accepted (always OK), `MODE` is not implemented.

## Source references

- `software/network/ftpd.cc`
- `software/network/network_config.h`
