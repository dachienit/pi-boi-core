REPORT zsample_abap.

* Optional input parameter
PARAMETERS: p_name TYPE string.

START-OF-SELECTION.

WRITE: / 'Xin chào ABAP!'.

IF p_name IS NOT INITIAL.
  WRITE: / 'Tên người dùng:', p_name.
ENDIF.
