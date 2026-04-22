CLASS zcl_simple_counter DEFINITION PUBLIC CREATE PUBLIC.
PUBLIC SECTION.
  METHODS: constructor IMPORTING iv_start TYPE i DEFAULT 0,
           increment IMPORTING iv_step TYPE i DEFAULT 1,
           get_value RETURNING VALUE(rv_value) TYPE i.
PRIVATE SECTION.
  DATA: iv_value TYPE i.
ENDCLASS.

CLASS zcl_simple_counter IMPLEMENTATION.
  METHOD constructor.
    iv_value = iv_start.
  ENDMETHOD.
  METHOD increment.
    iv_value = iv_value + iv_step.
  ENDMETHOD.
  METHOD get_value.
    rv_value = iv_value.
  ENDMETHOD.
ENDCLASS.