import { generateEmailVerificationLink } from "@/wab/server/emails/verification-email";
import { Request } from "express-serve-static-core";

function welcomeEmailHtml(
  verificationLink: string | null,
  firstName?: string
) {
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";
  const verificationBlock = verificationLink
    ? `<tr>
            <td style="padding: 0 0 24px 0;">
              <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 24px; color: #374151;">
                To get started, please verify your email address by clicking the button below:
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 0 24px 0;" align="center">
              <a href="${verificationLink}"
                 style="display: inline-block; padding: 14px 32px; background-color: #45b5f5; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px; mso-padding-alt: 0; text-align: center;">
                <!--[if mso]><i style="mso-font-width:150%;mso-text-raise:22pt">&nbsp;</i><![endif]-->
                Verify Email Address
                <!--[if mso]><i style="mso-font-width:150%">&nbsp;</i><![endif]-->
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 0 24px 0;">
              <p style="margin: 0; font-size: 13px; line-height: 20px; color: #9ca3af;">
                Or copy and paste this link into your browser:<br/>
                <a href="${verificationLink}" style="color: #45b5f5; word-break: break-all;">${verificationLink}</a>
              </p>
            </td>
          </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Plasmic</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" style="border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table role="presentation" width="560" style="border-collapse: collapse; max-width: 560px;">
          <!-- Header -->
          <tr>
            <td align="center" style="padding: 0 0 32px 0;">
              <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #45b5f5;">Plasmic</h1>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color: #ffffff; border-radius: 8px; padding: 40px 36px; border: 1px solid #e5e7eb;">
              <table role="presentation" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 0 0 24px 0;">
                    <h2 style="margin: 0 0 8px 0; font-size: 22px; font-weight: 600; color: #111827;">Welcome to Plasmic!</h2>
                    <p style="margin: 0; font-size: 16px; line-height: 24px; color: #374151;">
                      ${greeting} Thanks for signing up. We're excited to have you on board.
                    </p>
                  </td>
                </tr>
                ${verificationBlock}
                <!-- Divider -->
                <tr>
                  <td style="padding: 0 0 24px 0;">
                    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 0;">
                  </td>
                </tr>
                <tr>
                  <td style="padding: 0;">
                    <p style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #111827;">Join our community</p>
                    <p style="margin: 0 0 8px 0; font-size: 14px; line-height: 22px; color: #6b7280;">
                      For help, discussions, and feedback:
                    </p>
                    <p style="margin: 0 0 4px 0; font-size: 14px; line-height: 22px; color: #6b7280;">
                      Forum: <a href="https://forum.plasmic.app/" style="color: #45b5f5; text-decoration: none;">forum.plasmic.app</a>
                    </p>
                    <p style="margin: 0; font-size: 14px; line-height: 22px; color: #6b7280;">
                      Slack: <a href="https://plasmic.app/slack" style="color: #45b5f5; text-decoration: none;">plasmic.app/slack</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 24px 0 0 0;">
              <p style="margin: 0; font-size: 13px; line-height: 20px; color: #9ca3af;">
                &copy; ${new Date().getFullYear()} Plasmic Inc. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendWelcomeEmail(
  req: Request,
  email: string,
  token: string | null,
  nextPath?: string,
  firstName?: string
) {
  const verificationLink = token
    ? generateEmailVerificationLink(
        req.headers.origin ||
          `${req.protocol}://${req.get("host")}` ||
          req.config.host,
        token,
        nextPath
      )
    : null;

  await req.mailer.sendMail({
    from: req.config.mailFrom,
    to: email,
    bcc: req.config.mailBcc,
    subject: `Welcome to Plasmic`,
    html: welcomeEmailHtml(verificationLink, firstName),
  });
}
