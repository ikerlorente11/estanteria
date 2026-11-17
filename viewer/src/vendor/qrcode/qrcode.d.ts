// What src/views/TelegramLogin.vue uses of qrcode-generator (its own qrcode.d.ts declares the npm module name only).
interface QRCode {
  addData(data: string): void
  make(): void
  getModuleCount(): number
  createSvgTag(opts?: { cellSize?: number; margin?: number; scalable?: boolean }): string
}
declare function qrcode(typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'): QRCode
export default qrcode
