import nodemailer from 'nodemailer'
import type { SendMailOptions, Transporter } from 'nodemailer'

type MailHelperAuth = {
  user: string | undefined
  pass: string | undefined
}

type MailHelperTls = {
  rejectUnauthorized: boolean
}

export interface IMailHelperTransportOptions {
  host: string
  port: number
  secure: boolean
  auth: MailHelperAuth
  tls: MailHelperTls
}

export interface IMailHelperSendParams {
  from: string
  to: string
  subject: string
  html: string
  attachments?: SendMailOptions['attachments']
}

/** `mapErrorToUserFriendlyMessage` eşleşmezse; yalnızca bu durumda günlükte ham teknik ayrıntı saklanır. */
export const MAIL_ERROR_GENERIC =
  'Beklenmeyen bir hata oluştu. Daha sonra tekrar deneyin.'

export type MailErrorLike = {
  code?: string
  response?: string
  message?: string
}

export class MailHelper {
  private readonly _transporter: Transporter

  constructor(smtpConfig: IMailHelperTransportOptions) {
    const config: Parameters<typeof nodemailer.createTransport>[0] = {
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.auth.user,
        pass: smtpConfig.auth.pass,
      },
      tls: {
        rejectUnauthorized: smtpConfig.tls.rejectUnauthorized,
      },
    }
    if (!config.auth?.user) {
      delete config.auth
    } else if (!config.auth.pass) {
      config.auth = { user: config.auth.user, pass: '' }
    }
    this._transporter = nodemailer.createTransport(config)
  }

  /**
   * SMTP / nodemailer / Node ağ hatalarını kullanıcı mesajına çevirir.
   * DNS (yanlış host, yazım hatası) için `ENOTFOUND` veya iletide `getaddrinfo` kullanılır.
   */
  static mapErrorToUserFriendlyMessage(error: MailErrorLike): string {
    const code = error.code
    const message = error.message ?? ''

    if (
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      (message.includes('getaddrinfo') && message.includes('ENOTFOUND'))
    ) {
      return 'SMTP sunucu adresi yanlış veya çözülemedi. Ayarlar > SMTP bölümündeki sunucu adını kontrol edin (ör. smtp.gmail.com).'
    }
    if (code === 'ECONNREFUSED') {
      return 'SMTP sunucusu bağlantıyı reddetti. Port ve güvenli bağlantı (SSL/TLS) ayarlarını kontrol edin.'
    }
    if (code === 'ETIMEDOUT') {
      return 'SMTP sunucusuna bağlantı zaman aşımına uğradı. Ağ veya güvenlik duvarını kontrol edin.'
    }

    switch (code) {
      case 'ESOCKET':
      case 'ECONNECTION':
        return 'SMTP sunucusuna bağlanılamadı. SMTP adresi, port ve ağı kontrol edin.'
      case 'EAUTH':
        return 'Kullanıcı adı veya parola hatalı.'
      case 'EENVELOPE':
        if (error.response?.includes('Invalid sender')) {
          return 'Gönderen (From) adresi geçersiz görünüyor.'
        }
        if (error.response?.includes('Invalid recipient')) {
          return 'Alıcı adresi geçersiz.'
        }
        return 'E-posta adresleriyle ilgili bir hata oluştu.'
      case 'ETLS':
        return "Sunucu sertifikası güvenilir değil. Gerekirse 'Sertifika hatalarını yok say' seçeneğini açın."
      case 'EINVAL':
        return 'Bazı alanlar eksik veya geçersiz.'
      default:
        return MAIL_ERROR_GENERIC
    }
  }

  /** Anlamlı SMTP uyarısı yazıldıysa günlükte ham teknik satır saklanmaz. */
  static detailForEmailLog(friendlyMessage: string, rawMessage: string): string | null {
    return friendlyMessage === MAIL_ERROR_GENERIC ? rawMessage : null
  }

  send(params: IMailHelperSendParams): Promise<unknown> {
    const message: SendMailOptions = {
      from: params.from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }
    if (params.attachments?.length) {
      message.attachments = params.attachments
    }
    return new Promise((resolve, reject) => {
      this._transporter.sendMail(message, (err: Error | null, info: unknown) => {
        if (err) reject(err)
        else resolve(info)
      })
    })
  }
}
