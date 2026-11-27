import LegalPage from "@/components/LegalPage";

export const metadata = { title: "Privacy Policy — HookClip.pro" };

const SECTIONS = [
  {
    "heading": "Information We Process",
    "paragraphs": [
      "Account data: when you sign in through Clerk, we process your email address, display name, and Clerk user identifier for authentication and for linking your credit wallet to your account.",
      "Credit wallet data: wallet balance, top-up transactions, gateway references, and audit entries required for billing integrity and fraud prevention.",
      "Studio usage data: anonymous client sessions, submitted URLs or uploads, selected render options, job status, and worker logs so we can operate the rendering pipeline and diagnose failures."
    ],
    "bullets": [
      "We do not sell your videos, clips, or personal data.",
      "We do not use your media to train AI models.",
      "We do not process videos for any purpose other than producing the clips you requested."
    ]
  },
  {
    "heading": "Temporary Video Processing",
    "paragraphs": [
      "Videos you submit (by YouTube URL or direct upload) are downloaded to a temporary workspace on our GPU workers, processed into clips, and the rendered results are uploaded to an object-storage bucket that serves previews and downloads.",
      "Source media is treated as transient processing material and is removed from the worker workspace after the job finishes; only the rendered clips and their metadata are retained so you can preview and download them."
    ],
    "bullets": [
      "We do not sell your videos, clips, or personal data.",
      "We do not use your media to train AI models.",
      "We do not process videos for any purpose other than producing the clips you requested."
    ]
  },
  {
    "heading": "Cloudflare & Security",
    "paragraphs": [
      "This site is protected by Cloudflare (CDN, Turnstile human verification, and security analytics). Cloudflare may process request metadata (IP address, user agent, timestamps) under its own privacy policy to protect the platform from abuse."
    ]
  },
  {
    "heading": "Data Retention and Deletion",
    "paragraphs": [
      "Job records, clip metadata, and wallet transactions are retained while your account exists so history and billing remain accurate.",
      "You may request deletion of your account and associated personal data by emailing support@hookclip.pro. We will remove account-linked data within 30 days, except records we must retain for legal, accounting, or fraud-prevention obligations."
    ]
  },
  {
    "heading": "Contact",
    "paragraphs": [
      "Questions about this policy: support@hookclip.pro. Copyright and takedown matters: dmca@hookclip.pro."
    ]
  }
];

export default function Page() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="November 27, 2026"
      intro={"HookClip.pro (we, us) operates an AI video-clipping service. This policy explains what data we process when you use the platform, how temporary video processing works, and the rights you have over your data."}
      sections={SECTIONS}
    />
  );
}
