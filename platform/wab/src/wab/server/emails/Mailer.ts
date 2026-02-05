import { verifyEmailHtml } from "@/wab/server/emails/email-html";
import { logger } from "@/wab/server/observability";
import { getResendApiKey, getSmtpAuth } from "@/wab/server/secrets";
import { createTransport, SentMessageInfo, Transporter } from "nodemailer";
import Mail from "nodemailer/lib/mailer";

export interface Mailer {
  sendMail(mailOptions: Mail.Options): Promise<SentMessageInfo>;
}

class NodeMailer implements Mailer {
  constructor(private transporter: Transporter) {}
  async sendMail(mailOptions: Mail.Options): Promise<SentMessageInfo> {
    try {
      return await this.transporter.sendMail(mailOptions);
    } catch (error) {
      logger().error("Failed to send email", { error, to: mailOptions.to });
      throw error;
    }
  }
}

/**
 * Mailer that uses Resend's HTTP API directly.
 * More reliable than SMTP and provides clearer error messages.
 */
class ResendMailer implements Mailer {
  constructor(private apiKey: string) {}
  async sendMail(mailOptions: Mail.Options): Promise<SentMessageInfo> {
    const toAddresses = Array.isArray(mailOptions.to)
      ? mailOptions.to.map(String)
      : [String(mailOptions.to)];
    const body: Record<string, unknown> = {
      from: String(mailOptions.from),
      to: toAddresses,
      subject: mailOptions.subject,
      html: mailOptions.html,
    };
    if (mailOptions.bcc) {
      body.bcc = Array.isArray(mailOptions.bcc)
        ? mailOptions.bcc.map(String)
        : [String(mailOptions.bcc)];
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger().error("Resend API error", {
        status: response.status,
        body: errorBody,
        to: mailOptions.to,
      });
      throw new Error(
        `Resend API error (${response.status}): ${errorBody}`
      );
    }

    const result = await response.json();
    logger().info("Email sent via Resend", {
      id: result.id,
      to: mailOptions.to,
    });
    return result;
  }
}

class ConsoleMailer implements Mailer {
  async sendMail(mailOptions: Mail.Options): Promise<SentMessageInfo> {
    logger().info(`SENDING MAIL TO CONSOLE`, mailOptions);

    // Run verification during development
    if (typeof mailOptions.html === "string") {
      verifyEmailHtml(mailOptions.html);
    }

    // Delay to simulate sending
    await new Promise((resolve) => setTimeout(resolve, 5000));
    logger().info(`MAIL SENT`);
  }
}

export function createMailer() {
  // Check for Resend API key first (preferred for transactional email)
  const resendApiKey = getResendApiKey();
  if (resendApiKey) {
    logger().info("Using Resend HTTP API for transactional email");
    return new ResendMailer(resendApiKey);
  }

  if (process.env.NODE_ENV === "production") {
    const smtpHost =
      process.env.SMTP_HOST || "email-smtp.us-west-2.amazonaws.com";
    const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);

    return new NodeMailer(
      createTransport({
        host: smtpHost,
        port: smtpPort,
        auth: getSmtpAuth(),
      })
    );
  } else {
    return new ConsoleMailer();
  }
}
