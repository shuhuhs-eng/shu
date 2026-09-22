import { TextField } from "@/components/auth/text-field";
import { SNS_PLATFORMS } from "@/lib/validation/profile-options";
import type { SnsLink } from "@/types/database";

type Props = {
  defaultValues?: SnsLink[];
};

/**
 * SNSリンクの入力欄。SNS_PLATFORMS（lib/validation/profile-options.ts）に
 * 定義されたプラットフォームの数だけ入力欄を描画する。プラットフォームを
 * 増やす場合はSNS_PLATFORMSに追加するだけでよく、このコンポーネント自体の
 * 変更は不要（DBもjsonb配列のためマイグレーション不要）。
 * 現時点ではSNS_PLATFORMSにInstagramのみが定義されているため、表示もInstagramのみ。
 */
export function SnsLinksField({ defaultValues = [] }: Props) {
  return (
    <div className="space-y-4">
      {SNS_PLATFORMS.map((platform) => {
        const existing = defaultValues.find((d) => d.platform === platform.code);
        return (
          <TextField
            key={platform.code}
            id={`sns_${platform.code}`}
            name={`sns_${platform.code}`}
            label={`${platform.label}アカウント（任意）`}
            required={false}
            defaultValue={existing?.handle ?? ""}
            placeholder={platform.placeholder}
          />
        );
      })}
    </div>
  );
}
