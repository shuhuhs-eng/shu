import { setSalonInterestAction } from "@/lib/interests/actions";

type Props = {
  salonUserId: string;
  isInterested: boolean;
};

export function InterestSalonButton({ salonUserId, isInterested }: Props) {
  const action = setSalonInterestAction.bind(null, salonUserId, !isInterested);

  return (
    <form action={action} className="mt-3">
      <button
        type="submit"
        aria-pressed={isInterested}
        className="w-full rounded-full bg-ink px-5 py-3.5 text-[14px] font-semibold text-surface"
      >
        {isInterested ? "送信済み（取り消す）" : "このサロンの話を聞いてみたい"}
      </button>
      <p className="mt-2 text-center text-[11px] leading-relaxed text-sub">
        {isInterested
          ? "あなたの公開プロフィールがサロンに届いています"
          : "送信すると公開プロフィールがこのサロンに共有されます"}
      </p>
    </form>
  );
}
