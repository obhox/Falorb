import { DEFAULT_MASKING, type MaskingRules } from "./privacy";

/**
 * Generates the "what this site collects" text for a privacy policy.
 *
 * Written from the actual configuration rather than a generic template,
 * because the answer genuinely differs per project: a cookieless project makes
 * no cookie disclosure, an opt-in project has a different lawful basis, and a
 * project with org-scoped identity shares data across properties in a way that
 * has to be stated.
 *
 * Deliberately plain about limits as well as collection. A disclosure that
 * only lists what is gathered reads as evasive; saying explicitly that
 * browsing on other sites is not tracked is both true here and the thing a
 * reader actually wants to know.
 */

export interface DisclosureInput {
  projectName: string;
  domains: string[];
  consentMode: "off" | "opt_in" | "opt_out";
  cookieless: boolean;
  identityScope: "project" | "org";
  retentionDays: number;
  masking?: MaskingRules;
  /** Other properties data may be unified with, when identity is org-scoped. */
  siblingDomains?: string[];
  companyEnrichment?: boolean;
}

export function generateDisclosure(input: DisclosureInput): string {
  const masking = input.masking ?? DEFAULT_MASKING;
  const months = Math.round(input.retentionDays / 30);
  const retention =
    input.retentionDays >= 60 ? `${months} months` : `${input.retentionDays} days`;

  const sections: string[] = [];

  sections.push(
    `## Analytics on ${input.projectName}`,
    "",
    `${input.domains.length ? input.domains.join(", ") : "This site"} uses Falorb, a self-hosted analytics tool. ` +
      `The data described below is collected and stored by us directly. It is not sold, ` +
      `shared with advertising networks, or used to build cross-site advertising profiles.`,
    "",
  );

  sections.push(
    "### What is collected",
    "",
    "- Pages viewed, and the order they were viewed in",
    "- How long was spent on each page, and how far down it you scrolled",
    "- The site or search engine that referred you, and any campaign tag on the link",
    "- Approximate location: country, region and city, derived from your IP address",
    "- Device type, browser, operating system and screen size",
    "- Interactions on the page: clicks on links and buttons, form submissions, and JavaScript errors",
    "- Page performance timings",
    "",
  );

  sections.push(
    "### What is not collected",
    "",
    "- **Your activity on any other website.** No cross-site tracking is performed, and no third-party tracking cookies are set. We have no record of where you go after leaving, beyond a link you click that points elsewhere.",
    "- **Your IP address is never stored.** It is used in memory to derive your approximate location, then converted to an irreversible hash and discarded. The hash uses a key that changes daily, so it cannot be used to link your visits across days.",
    "- **Form contents.** We record that a form was submitted, never what was typed into it.",
    "- Names, email addresses, passwords or payment details, unless you explicitly provide them to us through a form or account.",
    "",
  );

  if (masking.stripParams.length || masking.scrubPatterns) {
    sections.push(
      "### Automatic redaction",
      "",
      "Before anything is stored, sensitive values are removed from recorded page addresses" +
        (masking.stripParams.length
          ? `, including the parameters: ${masking.stripParams.map((p) => `\`${p}\``).join(", ")}`
          : "") +
        (masking.scrubPatterns
          ? ". Anything resembling an email address or a long number sequence is replaced with a placeholder."
          : "."),
      "",
    );
  }

  sections.push("### Cookies and storage", "");
  if (input.cookieless) {
    sections.push(
      "This site's analytics are **cookieless**. No cookie is set and nothing is stored in your browser. " +
        "Returning visits are not recognised, and no identifier persists after you close the tab.",
      "",
    );
  } else {
    sections.push(
      "A single first-party identifier is stored in your browser to recognise repeat visits. " +
        "It is a random value with no meaning outside this site, it is not a third-party cookie, " +
        "and it is not readable by any other website.",
      "",
    );
  }

  sections.push("### Your choices", "");
  switch (input.consentMode) {
    case "opt_in":
      sections.push(
        "Nothing is collected until you consent. If you decline, or have not yet answered, no analytics data is recorded at all.",
        "",
      );
      break;
    case "opt_out":
      sections.push(
        "Analytics are collected by default, and you can withdraw at any time using the controls on this site. Withdrawal stops collection immediately.",
        "",
      );
      break;
    case "off":
      sections.push(
        "Analytics run on the basis of legitimate interest in understanding how this site is used.",
        "",
      );
      break;
  }
  sections.push(
    "We honour the **Do Not Track** and **Global Privacy Control** browser signals. " +
      "If either is enabled, no data is collected from your visit.",
    "",
  );

  if (input.identityScope === "org" && input.siblingDomains?.length) {
    sections.push(
      "### Across our products",
      "",
      `If you sign in to more than one of our products (${input.siblingDomains.join(", ")}), ` +
        "your activity on them is linked to a single profile. This only happens when you have " +
        "signed in, or followed a link directly from one of our sites to another — anonymous " +
        "visits are never linked across domains.",
      "",
    );
  }

  if (input.companyEnrichment) {
    sections.push(
      "### Organisation identification",
      "",
      "For business visitors, we may identify the *organisation* a visit came from using the " +
        "network operator that owns the IP range. This identifies a company, never an individual, " +
        "and consumer internet providers are excluded.",
      "",
    );
  }

  sections.push(
    "### Retention",
    "",
    `Raw activity data is kept for ${retention}, after which it is deleted automatically.`,
    "",
    "### Your rights",
    "",
    "You can request a copy of everything held about you, or ask for it to be deleted. " +
      "Deletion removes both your profile and your entire activity history, and is not reversible.",
    "",
  );

  return sections.join("\n");
}
