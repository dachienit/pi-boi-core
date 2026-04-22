CLASS zcl_hello DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS: say_hello IMPORTING iv_name TYPE string.
    METHODS: get_greeting RETURNING VALUE(rv_greeting) TYPE string.
  PRIVATE SECTION.
    DATA: mv_name TYPE string.
ENDCLASS.

CLASS zcl_hello IMPLEMENTATION.
  METHOD say_hello IMPORTING iv_name TYPE string.
    mv_name = iv_name.
  ENDMETHOD.
  METHOD get_greeting RETURNING VALUE(rv_greeting) TYPE string.
    rv_greeting = |Hello, { mv_name }!|.
  ENDMETHOD.
ENDCLASS.