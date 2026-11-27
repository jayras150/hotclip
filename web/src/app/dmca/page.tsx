import LegalPage from "@/components/LegalPage";

export const metadata = { title: "DMCA / Copyright Policy — HookClip.pro" };

const SECTIONS = [
  {
    "heading": "User Responsibility for Copyright",
    "paragraphs": [
      "By submitting a YouTube URL, podcast link, or file upload, you represent and warrant that you own the video or have permission from the rights holder (including music, footage, and personality rights) to process, re-cut, and re-publish it.",
      "Prohibited without authorization: processing copyrighted movies, TV shows, music videos, other creators channels, paywalled courses, or any third-party content for which you lack a license or a valid fair-use basis."
    ]
  },
  {
    "heading": "Enforcement Against Infringing Use",
    "paragraphs": [
      "Accounts that repeatedly process unauthorized material may be suspended and their render history reviewed for abuse. We may cancel queued jobs that clearly violate these rules."
    ]
  },
  {
    "heading": "Takedown Notices",
    "paragraphs": [
      "If you are a rights holder or an authorized agent and believe clips generated through our platform infringe your copyright, send a takedown notice to dmca@hookclip.pro including: identification of the copyrighted work, the clip job identifiers or URLs on our platform, your full name, address, phone number, and email, a statement of good-faith belief that the use is unauthorized, a statement under penalty of perjury that the information is accurate and you are the rights holder or authorized agent, and your physical or electronic signature."
    ]
  },
  {
    "heading": "Response and Counter-Notice",
    "paragraphs": [
      "Valid notices are processed within 5 business days: infringing clips are removed from preview download where identifiable and the originating account is notified.",
      "A user whose content was removed may file a counter-notice to dmca@hookclip.pro with the same formality; we may restore the content if the complaint is withdrawn or a court order authorizes it."
    ]
  },
  {
    "heading": "Repeat Infringers",
    "paragraphs": [
      "We operate a repeat-infringer policy: accounts subject to repeated valid takedown notices are permanently terminated."
    ]
  }
];

export default function Page() {
  return (
    <LegalPage
      title="DMCA / Copyright Policy"
      updated="November 27, 2026"
      intro={"HookClip.pro is a processing tool: it renders clips from videos that users submit. We do not host a media library and we do not select the sources. You the user are fully responsible for having the rights to process every video you submit."}
      sections={SECTIONS}
    />
  );
}
