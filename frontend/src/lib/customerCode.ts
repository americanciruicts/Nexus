// Customer code allows 200 characters, and spaces are not counted toward that
// (matches the API rule in traveler_schemas.CUSTOMER_CODE_MAX_CHARS). A value
// already over the limit stays editable — any change that shortens it is let
// through, so a legacy code can be trimmed back down.
export const CUSTOMER_CODE_MAX_CHARS = 200;
export const acceptCustomerCode = (next: string, prev = ''): boolean =>
  next.replace(/\s+/g, '').length <= CUSTOMER_CODE_MAX_CHARS || next.length < prev.length;
