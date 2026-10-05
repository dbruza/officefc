/**
 * Privacy policy, terms of use and support copy, as data. Rendered by `LegalDocument`
 * on the public /privacy, /terms and /support routes (also the App Store listing's
 * links). Keep the privacy policy in step with what the app and functions actually
 * collect, and bump `LEGAL_UPDATED` whenever the policy or terms change.
 */
import { SUPPORT_EMAIL } from "./constants";

/** ISO date the privacy policy and terms last changed. */
export const LEGAL_UPDATED = "2026-10-06";

/** A paragraph, or a bulleted list when it's an array. */
export type LegalBlock = string | readonly string[];

export interface LegalSection {
  heading: string;
  blocks: readonly LegalBlock[];
}

export interface LegalDoc {
  title: string;
  /** Short name for link rows ("Privacy · Terms · Support"). */
  label: string;
  /** In-app route, and the URL path on the web build. */
  href: "/privacy" | "/terms" | "/support";
  /** Header subtitle; defaults to the last-updated date. */
  subtitle?: string;
  /** Opening paragraph, set larger than the sections. */
  intro: string;
  sections: readonly LegalSection[];
}

export const PRIVACY_POLICY: LegalDoc = {
  title: "Privacy Policy",
  label: "Privacy",
  href: "/privacy",
  intro:
    "OfficeFC collects only what it needs to run your office league. No ads, no tracking, and your data is never sold. Here's what's collected, who sees it, and how to delete it.",
  sections: [
    {
      heading: "Who we are",
      blocks: [
        "OfficeFC is an independent app run by its developer, David Bruza, for private, invite-only workplace leagues for EA SPORTS FC. It's intended for adults and isn't directed at children.",
        `Questions about your data go to ${SUPPORT_EMAIL}.`,
      ],
    },
    {
      heading: "Your account",
      blocks: [
        "You sign up with an email address and password, handled by Firebase Authentication (a Google service). You'll need to verify your email before you can play. Your email is used to sign you in and is never shown to other players.",
      ],
    },
    {
      heading: "Your player profile",
      blocks: [
        "Your display name, @handle, jersey number and colour. Members of your league can see your profile.",
      ],
    },
    {
      heading: "League activity",
      blocks: [
        "Match results, the teams you used, match stats, ratings (ELO), predictions, player-of-the-match votes, and the reasons you give when you dispute a result.",
        "Members of your league see results, stats and ratings. Dispute reasons are seen by league admins. League data is stored in Google Cloud Firestore in Sydney, Australia.",
      ],
    },
    {
      heading: "Match photos",
      blocks: [
        "Photos of end-of-match stats screens that you choose to upload. They're stored privately in Firebase Storage, and members of your league view them through temporary links that expire after 10 minutes.",
        "You can delete a photo you submitted at any time. Drafts you never submit are deleted automatically after 24 hours.",
      ],
    },
    {
      heading: "AI features (only with your permission)",
      blocks: [
        "OfficeFC asks for your permission before your first photo is read by AI, and you can turn it off at any time in Settings.",
        [
          "Reading match photos: your stats-screen photo is sent through OpenRouter to Meta's Muse Spark model, which reads the stats so you don't have to type them.",
          "Match analysis (optional): the match's stats and ratings, but not names or photos, are sent through OpenRouter to AI models that write a summary of the match.",
        ],
        "OpenRouter and the model providers process this data to return the result.",
      ],
    },
    {
      heading: "Notifications",
      blocks: [
        "To send you notifications, OfficeFC stores your device's Expo push token and your notification preferences. Expo's push service delivers the notifications.",
      ],
    },
    {
      heading: "Crash reports and diagnostics",
      blocks: [
        "To find and fix problems, the app sends crash reports and performance data to Sentry, and app logs to Google Cloud Logging. These are linked to an anonymous user ID, not your email, and kept for a limited period (up to 90 days).",
      ],
    },
    {
      heading: "Reports and blocks",
      blocks: ["Reports and blocks you make are stored so league admins can review them."],
    },
    {
      heading: "What we don't do",
      blocks: [
        [
          "No ads.",
          "No tracking you across other apps or websites.",
          "No selling your data, and no sharing it with data brokers.",
        ],
      ],
    },
    {
      heading: "Services we use",
      blocks: [
        "These services handle data to run OfficeFC:",
        [
          "Google Firebase and Google Cloud: sign-in, league data, match photos and app logs.",
          "Expo: delivering push notifications.",
          "Sentry: crash reports and performance data.",
          "OpenRouter and the AI model providers it uses, including Meta: AI photo reading and match analysis, only with your permission.",
        ],
        "Some of these services may process data outside Australia.",
      ],
    },
    {
      heading: "Keeping and deleting your data",
      blocks: [
        "Your data is kept while your account exists. You can delete your account at any time in Settings → Delete account. That deletes:",
        [
          "your login and email address",
          "your profile",
          "your match photos",
          "your notification tokens and settings",
        ],
        `Your name in past results is replaced with "Deleted player". The match results themselves are kept, without your personal details, so other players' records stay correct.`,
        `You can also email ${SUPPORT_EMAIL} to ask for your account to be deleted.`,
      ],
    },
    {
      heading: "Your choices",
      blocks: [
        [
          "Edit your profile at any time.",
          "Mute notification categories in Settings.",
          "Turn off AI photo reading in Settings.",
          "Delete any match photo you submitted.",
          "Delete your account in Settings → Delete account.",
        ],
      ],
    },
    {
      heading: "Changes and contact",
      blocks: [
        "If this policy changes, the date at the top will change with it.",
        `Questions, or something you'd like corrected or deleted? Email ${SUPPORT_EMAIL}.`,
      ],
    },
  ],
};

export const TERMS_OF_USE: LegalDoc = {
  title: "Terms of Use",
  label: "Terms",
  href: "/terms",
  intro:
    "The rules for using OfficeFC, which come down to: play fair and be decent. By creating an account you agree to them.",
  sections: [
    {
      heading: "About OfficeFC",
      blocks: [
        "OfficeFC is an independent app run by its developer, David Bruza, for private, invite-only workplace leagues for EA SPORTS FC. You join with a code from your league admin. It's intended for adults.",
      ],
    },
    {
      heading: "Your account",
      blocks: [
        "Use your own details, one account per person, and keep your password to yourself. You're responsible for what's posted from your account.",
      ],
    },
    {
      heading: "Zero tolerance for objectionable content and abusive users",
      blocks: [
        "OfficeFC has zero tolerance for objectionable content or abusive users. Everything you post, from your name to a dispute reason, is seen by your colleagues. So:",
        [
          "No offensive, hateful, sexual or harassing names, handles, photos or dispute text.",
          "No bullying, threatening or harassing other players.",
          "No impersonating anyone else.",
          "No cheating: no fake results, made-up scores or edited stats photos.",
        ],
      ],
    },
    {
      heading: "Reporting and blocking",
      blocks: [
        "You can report a player, or block a player, from their profile. League admins review reports within 24 hours. They remove offending content, and they remove users who break these rules from the league.",
        `You can also report anything to ${SUPPORT_EMAIL}.`,
      ],
    },
    {
      heading: "If you break the rules",
      blocks: [
        "Content that breaks these terms is removed. Users who break them are removed from the league, and their accounts can be removed too.",
      ],
    },
    {
      heading: "Your content",
      blocks: [
        "You're responsible for what you post: your profile, results, photos and dispute reasons. You let OfficeFC store it and show it to your league so the app can work. What happens to it when you delete your account is set out in the Privacy Policy.",
      ],
    },
    {
      heading: "Not affiliated with EA SPORTS",
      blocks: [
        "OfficeFC isn't affiliated with, or endorsed or sponsored by, Electronic Arts, EA SPORTS or FIFA. Team names are used only to record which teams were played. All trademarks belong to their owners.",
      ],
    },
    {
      heading: "No warranty",
      blocks: [
        "OfficeFC is provided as-is, for a friendly league. It may not always be available or error-free, and ratings and stats are for fun. To the extent the law allows, it comes with no warranty, and we aren't liable for losses from using it. Nothing here limits rights you have under consumer law that can't be excluded.",
      ],
    },
    {
      heading: "Leaving",
      blocks: [
        "You can stop using OfficeFC and delete your account at any time in Settings → Delete account.",
      ],
    },
    {
      heading: "Changes and contact",
      blocks: [
        "If these terms change, the date at the top will change with it. Carrying on using OfficeFC after a change means you accept the new terms.",
        `Questions about these terms? Email ${SUPPORT_EMAIL}.`,
      ],
    },
  ],
};

export const SUPPORT: LegalDoc = {
  title: "Support",
  label: "Support",
  href: "/support",
  subtitle: "Help with OfficeFC",
  intro: "Answers to the common questions. Still stuck? Email us and we'll help.",
  sections: [
    {
      heading: "Joining a league",
      blocks: [
        "OfficeFC leagues are private and invite-only. Ask your league admin for the join code or an invite link, then create an account, verify your email, set up your player profile and enter the code. An invite link fills the code in for you.",
      ],
    },
    {
      heading: "No verification email?",
      blocks: [
        "Check your spam or junk folder. The verify screen can send it again if it still hasn't arrived.",
      ],
    },
    {
      heading: "Forgotten your password",
      blocks: [
        "On the sign-in screen, tap Forgot password? and enter your email. You'll get a link to set a new one.",
      ],
    },
    {
      heading: "Reporting or blocking a player",
      blocks: [
        "Open the player's profile and tap the shield at the top to report or block them. League admins review reports within 24 hours.",
      ],
    },
    {
      heading: "Deleting your account",
      blocks: [
        `Go to Settings → Delete account. Your login, email, profile, photos and notification settings are deleted, and your past results stay in the league as "Deleted player". You can also email ${SUPPORT_EMAIL} and ask.`,
      ],
    },
  ],
};

/** Every document, in link-row order. */
export const LEGAL_DOCS: readonly LegalDoc[] = [PRIVACY_POLICY, TERMS_OF_USE, SUPPORT];
