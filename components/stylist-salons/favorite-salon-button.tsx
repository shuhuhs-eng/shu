import { setFavoriteSalonAction } from "@/lib/favorites/actions";

type Props = {
  salonUserId: string;
  isFavorite: boolean;
  className?: string;
};

export function FavoriteSalonButton({ salonUserId, isFavorite, className = "" }: Props) {
  const action = setFavoriteSalonAction.bind(null, salonUserId, !isFavorite);

  return (
    <form action={action} className={className}>
      <button
        type="submit"
        aria-pressed={isFavorite}
        className="w-full rounded-full border border-line bg-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink"
      >
        <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>{" "}
        {isFavorite ? "気になるサロンから外す" : "気になるサロンに保存"}
      </button>
    </form>
  );
}
