declare module 'qrcode' {
  export interface QRCodeCreateOptions {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  }

  export interface QRCodeRenderersOptions {
    type?: 'image/png' | 'image/jpeg' | 'image/webp' | 'svg'
    margin?: number
    width?: number
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  }

  export interface QRCodeToStringOptions extends QRCodeRenderersOptions {
    type?: 'svg' | 'utf8' | 'terminal'
  }

  export interface QRCodeToDataURLOptions extends QRCodeRenderersOptions {
    rendererOpts?: { quality?: number }
  }

  export interface QRCode {
    modules: {
      size: number
      data: Uint8Array
    }
  }

  export function create(text: string, options?: QRCodeCreateOptions): QRCode

  export function toString(
    text: string,
    options?: QRCodeToStringOptions
  ): Promise<string>

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions
  ): Promise<string>
}
