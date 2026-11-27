import LegalPage from "@/components/LegalPage";

export const metadata = { title: "Terms of Service — HookClip.pro" };

const SECTIONS = [
  {
    "heading": "The Service",
    "paragraphs": [
      "HookClip.pro converts long-form videos into short vertical clips using automated AI processing (transcription, hook scoring, face tracking, karaoke subtitles) rendered on rented GPU infrastructure.",
      "Render quality, duration, and availability depend on third-party GPU providers and may vary between jobs. We aim for reliable output but do not guarantee a specific viral performance of any clip."
    ]
  },
  {
    "heading": "Your Accounts and Credits",
    "paragraphs": [
      "You are responsible for keeping your Clerk account credentials secure and for all activity performed through your account.",
      "Renders consume credits from your wallet. Credits are prepaid, have no cash value, are not transferable, and do not expire while your account is active."
    ]
  },
  {
    "heading": "Content You Submit",
    "paragraphs": [
      "You retain ownership of the videos you submit and of the clips generated from them, subject to the rights of any copyright holders in the underlying material.",
      "You confirm you have the legal right to process every video you submit. You are solely responsible for the sources you upload or link; see our DMCA copyright policy for enforcement details."
    ]
  },
  {
    "heading": "Acceptable Use",
    "paragraphs": [
      "You may not use the service to process unlawful content, material you have no rights to, malware, sexual content involving minors, or anything that violates the law or third-party rights.",
      "You may not attempt to bypass quotas, rate limits, authentication, or credit guards, or to resell raw GPU access from the platform."
    ]
  },
  {
    "heading": "Warranty Disclaimer and Limitation of Liability",
    "paragraphs": [
      "The service is provided as is without warranties of any kind. To the maximum extent permitted by law, HookClip.pro is not liable for indirect, incidental, or consequential damages, lost profits, or lost data arising from your use of the service.",
      "Our aggregate liability for any claim is limited to the amount of credits you purchased in the twelve months preceding the claim."
    ]
  },
  {
    "heading": "Changes and Termination",
    "paragraphs": [
      "We may update these Terms; material changes will be reflected by the last updated date. We may suspend or terminate accounts that abuse the service or violate these Terms."
    ]
  }
];

export default function Page() {{
  return (
    <LegalPage
      title="Terms of Service"
      updated="November 27, 2026"
      intro={"These Terms govern your use of HookClip.pro. By creating an account, submitting a job, or purchasing credits, you agree to these Terms."}
      sections={SECTIONS}
    />
  );
}}
