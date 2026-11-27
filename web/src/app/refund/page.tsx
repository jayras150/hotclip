import LegalPage from "@/components/LegalPage";

export const metadata = { title: "Refund & Cancellation Policy — HookClip.pro" };

const SECTIONS = [
  {
    "heading": "Credit Purchases",
    "paragraphs": [
      "Credits are purchased in packages and are added to your wallet after payment is settled by the gateway (Midtrans, Xendit, Tripay, or manual bank transfer).",
      "Once credits have been consumed by a successful render, that portion of the purchase is non-refundable the GPU cost has already been incurred on your behalf."
    ]
  },
  {
    "heading": "Unused Credits",
    "paragraphs": [
      "Unused credits may be refunded within 7 days of the original payment if no credits from that payment have been spent. Request a refund by emailing support@hookclip.pro with your transaction ID.",
      "Approved refunds are returned through the original payment method, or via bank transfer where the gateway cannot reverse the charge. Gateway and transfer fees may be deducted."
    ]
  },
  {
    "heading": "Failed Renders Automatic Credit Return",
    "paragraphs": [
      "If a render fails because of a system or server error (provisioning failure, worker crash, pipeline timeout), you do not pay for it: the credits reserved for the job are returned to your wallet automatically, or on report.",
      "For refunds of credits consumed by jobs that failed, contact support@hookclip.pro with the job ID shown in My Clips. We verify job status in our logs and restore qualifying credits to your wallet."
    ]
  },
  {
    "heading": "What Is Not Refundable",
    "paragraphs": [
      "Successful renders, regardless of your satisfaction with clip performance.",
      "Jobs that failed because the source URL was invalid, private, region-locked, or the video content was unreadable these are user-side input issues.",
      "Accounts terminated for violation of the Terms of Service."
    ]
  },
  {
    "heading": "Chargebacks",
    "paragraphs": [
      "Please contact us before filing a chargeback; we can resolve most billing issues faster directly. Accounts with fraudulent chargebacks may be suspended."
    ]
  }
];

export default function Page() {{
  return (
    <LegalPage
      title="Refund & Cancellation Policy"
      updated="November 27, 2026"
      intro={"This policy explains when credit purchases can be refunded or cancelled and how automatic credit restoration works when a render fails due to a system error."}
      sections={SECTIONS}
    />
  );
}}
