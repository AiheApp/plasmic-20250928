import { setupEmailTest } from "@/wab/server/emails/test/email-test-util";
import { sendEmailVerificationToUser } from "@/wab/server/emails/verification-email";

describe("sendEmailVerificationToUser", () => {
  it("sends a verification email", async () => {
    const { req, config, mailer } = setupEmailTest();
    await sendEmailVerificationToUser(
      req,
      "newuser@example.com",
      "OneTimeUseToken",
      "/"
    );
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    const callArgs = mailer.sendMail.mock.calls[0][0];
    expect(callArgs.from).toBe(config.mailFrom);
    expect(callArgs.to).toBe("newuser@example.com");
    expect(callArgs.bcc).toBe(req.config.mailBcc);
    expect(callArgs.subject).toBe("Verify your email address for Plasmic");
    expect(callArgs.html).toContain("Verify your email address");
    expect(callArgs.html).toContain("Verify Email Address");
    expect(callArgs.html).toContain(
      "https://studio.plasmic.app/email-verification?token=OneTimeUseToken&continueTo=%2F"
    );
    expect(callArgs.html).toContain(
      "If you didn't create an account on Plasmic"
    );
  });

  it("uses custom app name when provided", async () => {
    const { req, mailer } = setupEmailTest();
    await sendEmailVerificationToUser(
      req,
      "newuser@example.com",
      "OneTimeUseToken",
      "/auth-callback",
      "My App"
    );
    const callArgs = mailer.sendMail.mock.calls[0][0];
    expect(callArgs.subject).toBe("Verify your email address for My App");
    expect(callArgs.html).toContain("My App");
    expect(callArgs.html).toContain(
      "If you didn't create an account on My App"
    );
  });
});
