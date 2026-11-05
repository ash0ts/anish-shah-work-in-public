const PRIVATE_DATA =
  /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:sk|AIza)[-_A-Za-z0-9]{16,}|\b(?:\+?\d[\d ().-]{8,}\d)\b|(?:\/Users\/|file:\/\/|\b(?:password|api[_ -]?key|access[_ -]?token|social security|home address)\s*[:=]))/i;
const INSTRUCTION_ATTACK =
  /(?:ignore\s+(?:all\s+)?(?:previous|prior|system)\s+instructions|reveal\s+(?:the\s+)?(?:system\s+prompt|secrets?)|pretend\s+(?:you\s+are|to\s+be)\s+Anish|<\/?(?:system|assistant|script)\b)/i;
export function conversationInputAllowed(value: string): boolean {
  return (
    value.length <= 800 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) &&
    !PRIVATE_DATA.test(value) &&
    !INSTRUCTION_ATTACK.test(value)
  );
}
export function conversationSourceAllowed(value: string): boolean {
  return !PRIVATE_DATA.test(value) && !/https?:\/\//i.test(value);
}
