import { zxcvbnAsync, zxcvbnOptions } from "@zxcvbn-ts/core";
import {
  adjacencyGraphs,
  dictionary as commonDictionary,
} from "@zxcvbn-ts/language-common";
import {
  dictionary as englishDictionary,
  translations,
} from "@zxcvbn-ts/language-en";

const passwordStrengthOptions = {
  translations: translations,
  graphs: adjacencyGraphs,
  dictionary: {
    ...commonDictionary,
    ...englishDictionary,
  },
};

const passwordCommonWords = ["plasmic"];

// Only register the pwned password matcher on the server side.
// The browser's crypto.subtle may not be available (e.g., webpack polyfills
// crypto without subtle support), causing "Cannot read properties of undefined
// (reading 'digest')" errors. The server already checks for pwned passwords
// separately via the `hibp` package in DbMgr.
if (typeof window === "undefined") {
  try {
    const { matcherPwnedFactory } = require("@zxcvbn-ts/matcher-pwned");
    const fetch = require("isomorphic-unfetch");
    const matcherPwned = matcherPwnedFactory(fetch, zxcvbnOptions);
    zxcvbnOptions.addMatcher("pwnd", matcherPwned);
  } catch (_e) {
    // Silently skip if matcher-pwned is not available
  }
}
zxcvbnOptions.setOptions(passwordStrengthOptions);

export async function ratePasswordStrength(password: string) {
  const result = await zxcvbnAsync(password, passwordCommonWords);
  return result.score;
}
