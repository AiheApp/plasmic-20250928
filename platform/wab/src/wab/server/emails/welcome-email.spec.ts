import { setupEmailTest } from "@/wab/server/emails/test/email-test-util";
import { sendWelcomeEmail } from "@/wab/server/emails/welcome-email";

describe("sendWelcomeEmail", () => {
  it("sends an email with verification link", async () => {
    const { req, config, mailer } = setupEmailTest();
    await sendWelcomeEmail(req, "newuser@example.com", "OneTimeUseToken", "/");
    expect(mailer.sendMail).toHaveBeenCalledTimes(1);
    const callArgs = mailer.sendMail.mock.calls[0][0];
    expect(callArgs.from).toBe(config.mailFrom);
    expect(callArgs.to).toBe("newuser@example.com");
    expect(callArgs.bcc).toBe(req.config.mailBcc);
    expect(callArgs.subject).toBe("Welcome to Plasmic");
    expect(callArgs.html).toContain("Welcome to Plasmic!");
    expect(callArgs.html).toContain("Verify Email Address");
    expect(callArgs.html).toContain(
      "https://studio.plasmic.app/email-verification?token=OneTimeUseToken&continueTo=%2F"
    );
  });

  it("sends an email without verification link when no token", async () => {
    const { req, mailer } = setupEmailTest();
    await sendWelcomeEmail(req, "newuser@example.com", null);
    const callArgs = mailer.sendMail.mock.calls[0][0];
    expect(callArgs.html).toContain("Welcome to Plasmic!");
    expect(callArgs.html).not.toContain("Verify Email Address");
  });

  it("includes first name when provided", async () => {
    const { req, mailer } = setupEmailTest();
    await sendWelcomeEmail(
      req,
      "newuser@example.com",
      "OneTimeUseToken",
      "/",
      "Shahar"
    );
    const callArgs = mailer.sendMail.mock.calls[0][0];
    expect(callArgs.html).toContain("Hi Shahar,");
  });
});
