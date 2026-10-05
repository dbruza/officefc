/**
 * Reader for the documents in `@/lib/legal` (privacy policy, terms, support): title +
 * last-updated date, sections of paragraphs and bullet lists, then links to the other
 * documents. The support address is tappable wherever it appears in the copy.
 *
 * Two ways in:
 * - The public /privacy, /terms and /support routes (`LegalDocument`), for the App Store
 *   listing and shared links. They also have to work as the first page loaded, so with no
 *   history there's no back arrow, just a way into the app.
 * - An in-app sheet (`useLegalSheet`), for links inside the app. The root navigator shows
 *   one route group at a time, so navigating to a public route would unmount the screen
 *   underneath — a half-typed sign-up form, or the whole signed-in app.
 */
import { Fragment, useState, type ReactNode } from "react";
import {
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { Button, IconButton } from "./Button";
import { Card } from "./Card";
import { Icon } from "./Icon";
import { Page } from "./Page";
import { Reveal } from "./motion";
import { ScreenHeader } from "./ScreenHeader";
import { Txt } from "./Txt";
import { SUPPORT_EMAIL } from "@/lib/constants";
import { LEGAL_DOCS, LEGAL_UPDATED, type LegalBlock, type LegalDoc } from "@/lib/legal";
import { withAlpha } from "@/lib/color";
import { toast } from "@/lib/toast";
import { colors, radius, spacing } from "@/theme";

type LegalHref = LegalDoc["href"];

/** Start an email to support; says where to write instead if no mail app opens. */
export function emailSupport(): void {
  Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {
    toast.info(`Couldn't open a mail app. Email us at ${SUPPORT_EMAIL}.`);
  });
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function subtitleOf(doc: LegalDoc): string {
  return doc.subtitle ?? `Last updated ${formatDate(LEGAL_UPDATED)}`;
}

/** Copy with every mention of the support address turned into a mailto link. */
function withEmailLinks(text: string, size: number): ReactNode[] {
  return text.split(SUPPORT_EMAIL).flatMap((part, i) =>
    i === 0
      ? [part]
      : [
          <Txt
            key={i}
            variant="bodyMedium"
            size={size}
            color={colors.accent}
            accessibilityRole="link"
            onPress={emailSupport}
          >
            {SUPPORT_EMAIL}
          </Txt>,
          part,
        ],
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (typeof block === "string") {
    return (
      <Txt size={14} color={colors.textDim} style={styles.paragraph}>
        {withEmailLinks(block, 14)}
      </Txt>
    );
  }
  return (
    <View style={styles.list}>
      {block.map((item, i) => (
        <View key={i} style={styles.item}>
          <View style={styles.bullet} />
          <Txt size={14} color={colors.textDim} style={styles.itemText}>
            {withEmailLinks(item, 14)}
          </Txt>
        </View>
      ))}
    </View>
  );
}

function SupportContact() {
  return (
    <Card
      onPress={emailSupport}
      accessibilityLabel={`Email support at ${SUPPORT_EMAIL}`}
      style={styles.contact}
    >
      <View style={styles.contactIcon}>
        <Icon name="inbox" size={18} color={colors.accent} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt variant="head" size={15}>
          Email support
        </Txt>
        <Txt size={13} color={colors.textDim} style={{ marginTop: 2 }} numberOfLines={1}>
          {SUPPORT_EMAIL}
        </Txt>
      </View>
      <Icon name="chevron" size={15} color={colors.textFaint} />
    </Card>
  );
}

/** Intro and sections, shared by the public routes and the in-app sheet. */
function LegalBody({ doc }: { doc: LegalDoc }) {
  return (
    <>
      <Reveal>
        <Txt size={15.5} style={styles.intro}>
          {withEmailLinks(doc.intro, 15.5)}
        </Txt>
      </Reveal>
      {doc.href === "/support" ? <SupportContact /> : null}
      {doc.sections.map((section, index) => (
        <Reveal key={section.heading} index={index + 1} style={styles.section}>
          <Txt variant="head" size={16} accessibilityRole="header">
            {section.heading}
          </Txt>
          {section.blocks.map((block, blockIndex) => (
            <Block key={blockIndex} block={block} />
          ))}
        </Reveal>
      ))}
    </>
  );
}

/**
 * "Privacy · Terms · Support" row. Pass `onOpen` inside the app (it opens the sheet);
 * without it the links navigate, which is right only on the public routes themselves.
 */
export function LegalLinks({
  current,
  onOpen,
  style,
}: {
  /** The document being shown, left out of the row. */
  current?: LegalHref;
  onOpen?: (href: LegalHref) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const docs = LEGAL_DOCS.filter((doc) => doc.href !== current);
  return (
    <View style={[styles.links, style]}>
      {docs.map((doc, i) => (
        <Fragment key={doc.href}>
          {i > 0 ? (
            <Txt size={12} color={colors.textDisabled}>
              ·
            </Txt>
          ) : null}
          {onOpen ? (
            <Txt
              size={12}
              color={colors.textDim}
              accessibilityRole="link"
              onPress={() => onOpen(doc.href)}
              style={styles.link}
            >
              {doc.label}
            </Txt>
          ) : (
            <Link href={doc.href} push style={styles.link}>
              <Txt size={12} color={colors.textDim}>
                {doc.label}
              </Txt>
            </Link>
          )}
        </Fragment>
      ))}
    </View>
  );
}

/** A public route page: /privacy, /terms or /support. */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  const router = useRouter();
  // Opened from a link → the usual back arrow. Landed on directly (a shared link, the App
  // Store listing, a refresh) → nothing to go back to, so offer the way in.
  const canGoBack = router.canGoBack();
  return (
    <Page
      width="narrow"
      header={
        <ScreenHeader
          title={doc.title}
          subtitle={subtitleOf(doc)}
          back={canGoBack}
          right={
            canGoBack ? null : (
              <Button
                size="sm"
                variant="dark"
                onPress={() => router.replace("/")}
                style={{ alignSelf: "center" }}
              >
                Open OfficeFC
              </Button>
            )
          }
        />
      }
      contentStyle={styles.content}
    >
      <LegalBody doc={doc} />
      <LegalLinks current={doc.href} style={styles.foot} />
    </Page>
  );
}

/**
 * Open a legal document over the current screen: `open("/privacy")`, and render `sheet`
 * somewhere in the screen's tree.
 */
export function useLegalSheet(): { open: (href: LegalHref) => void; sheet: ReactNode } {
  const [href, setHref] = useState<LegalHref | null>(null);
  const doc = LEGAL_DOCS.find((item) => item.href === href) ?? null;
  return {
    open: setHref,
    sheet: (
      <Modal
        visible={doc !== null}
        animationType="slide"
        // iOS draws its own card sheet; elsewhere the modal covers the screen.
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
        onRequestClose={() => setHref(null)}
      >
        {doc ? (
          <SafeAreaView
            style={styles.sheet}
            edges={Platform.OS === "ios" ? ["bottom"] : ["top", "bottom"]}
          >
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt variant="head" size={18} accessibilityRole="header" numberOfLines={1}>
                  {doc.title}
                </Txt>
                <Txt size={12} color={colors.textDim} style={{ marginTop: 2 }}>
                  {subtitleOf(doc)}
                </Txt>
              </View>
              <IconButton icon="x" accessibilityLabel="Close" onPress={() => setHref(null)} />
            </View>
            <ScrollView contentContainerStyle={[styles.content, styles.sheetBody]}>
              <LegalBody key={doc.href} doc={doc} />
              <LegalLinks current={doc.href} onOpen={setHref} style={styles.foot} />
            </ScrollView>
          </SafeAreaView>
        ) : null}
      </Modal>
    ),
  };
}

const styles = StyleSheet.create({
  content: { gap: spacing.x2 },
  intro: { lineHeight: 23 },
  section: { gap: spacing.sm },
  paragraph: { lineHeight: 21 },
  list: { gap: spacing.xs },
  item: { flexDirection: "row", gap: spacing.sm },
  itemText: { flex: 1, lineHeight: 21 },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginTop: 9,
    backgroundColor: withAlpha(colors.textDim, 0.6),
  },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  link: { paddingVertical: spacing.xs },
  foot: {
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  contact: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderColor: withAlpha(colors.accent, 0.35),
  },
  contactIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(colors.accent, 0.12),
  },
  sheet: { flex: 1, backgroundColor: colors.bg },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  sheetBody: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.x4,
  },
});
