---
"lissio": minor:added
---

RawData can now send arbitrary bytes with one encoding vocabulary for the panel
and the terminal: ASCII, UTF-8, GBK and HEX. HEX accepts `AA 01`, `0xAA,0x01`,
`AA0102`, `\xAA\x01` and `AA:01` forms and validates every token instead of
silently dropping invalid characters; ASCII, UTF-8 and GBK encode the input
before it leaves the view, so a GBK device receives GBK bytes rather than a
UTF-8 approximation. Characters the selected encoding cannot represent are
reported instead of being replaced with `?`, and the byte count/preview update
as you type. The line-ending selector gained CR and CRLF so serial devices that
expect `\r` or `\r\n` no longer need an extra command block.

Files can be sent from the same composer: the desktop build uses the native file
dialog and the Web build the browser file picker, while dropping a file on the
composer works in both. Files are read once and written in 4 KiB chunks with
progress, a cancel action that stops at a chunk boundary, and a 64 MiB guard, so
a large firmware image does not fill the transport buffer in one call. The former
text-only send strip is replaced by one composer shared by the bottom and side
layouts, with send history, target connection state, drag-and-drop feedback and
control sizing on the same 28px/`--form-control-height` scale as the other
panels. The composer is a collapsible two-row panel: folding hides the
configuration row (encoding, target, line ending) but keeps the input row, so
the reading area grows without taking the send action away. Selection uses the
same solid fill as the other selected controls, and expanding the configuration
row uses the shared content-entry motion.

Terminal mode now has terminal input instead of reusing the text send box. Line
mode edits a command, recalls history with Up/Down, sends with the selected
CR/LF/CRLF ending and maps Ctrl+C/Ctrl+D/Ctrl+L; key mode forwards printable keys,
arrow/Home/End/Delete/F1-F12 sequences and Ctrl combinations straight to the
transport. Both modes encode text with the same ASCII/UTF-8/GBK selection as the
send composer. Both modes share a quick-key strip (Esc/Tab/Ctrl+C/Ctrl+D/Ctrl+Z),
clear-screen, local echo and the same file sender, so a serial console can be
driven without leaving the RawData widget.
