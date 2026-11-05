import type { InternetObject } from "@/lib/simulation/personal-internet";

/** Original toy-like drawings. No product screenshot or external brand asset. */
export function ObjectSprite({
  kind,
  variant = 0,
}: {
  kind: InternetObject["kind"];
  variant?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 144 112"
      fill="none"
      stroke="#26203d"
      strokeWidth="3"
      strokeLinejoin="round"
    >
      {kind === "terminal" ? (
        <>
          <path
            d="M18 83h108l9 12-6 7H12l-4-7z"
            fill={variant % 2 ? "#ff907e" : "#b6a0fa"}
          />
          <path
            d="M26 10h91l7 73H18z"
            fill={variant % 2 ? "#ffd488" : "#ccbbff"}
          />
          <path d="M36 20h70l4 50H30z" fill="#282640" />
          <path d="m42 35 10 8-11 8m20 0h18" stroke="#d4fa91" strokeWidth="4" />
          <path d="M30 91h62m8 0h11" />
          <path d="M91 76h10" strokeWidth="2" />
          <path d="M110 32h17v13h-15" fill="#ffed7a" />
        </>
      ) : kind === "notebook" ? (
        <>
          <path d="m28 13 88 4 8 82-91 4z" fill="#8ddfc3" />
          <path d="m36 11 78 6 3 77-81 7z" fill="#fff8db" />
          <path d="M40 11v88" />
          <path
            d="m53 35 42 3m-42 9 30 2m-29 10 40 3m-39 9 24 1"
            stroke="#6c6484"
            strokeWidth="2"
          />
          {[24, 41, 58, 75].map((y) => (
            <path key={y} d={`M24 ${y}h20`} strokeWidth="4" />
          ))}
          <path d="m99 10 12 3-17 67-9 8-3-12z" fill="#ff9385" />
          <path d="m85 83 9-3-6 9z" fill="#26203d" />
          <path
            d="m57 13 6-10 8 9 11-3-2 12 8 7-12 3-5 11-7-10-12-1 7-9z"
            fill="#c4b1f9"
            strokeWidth="2"
          />
        </>
      ) : kind === "document" ? (
        <>
          <path d="m29 18 73-7 14 84-75 9z" fill="#c9b7fc" />
          <path d="m20 9 67 4 20 18-7 68-87-5z" fill="#fff8e9" />
          <path d="m87 13-1 20 21-2" fill="#ffbe91" />
          <path d="m28 55 11-14 10 24 14-28 11 16 13-7" stroke="#a34474" />
          <path d="m27 77 51 3m-53 7 32 2" strokeWidth="2" />
          <circle cx="111" cy="67" r="20" fill="#97e0ca" fillOpacity=".9" />
          <path d="m122 84 14 16" strokeWidth="8" />
          <path d="m102 65 7 6 11-12" />
        </>
      ) : (
        <>
          <path d="M23 10h96v93H23z" fill="#ff958b" />
          <path d="M29 16h84v81H29z" strokeDasharray="3 4" />
          <path
            d="m67 24 9 14 17-1-9 15 7 16-18-4-12 11-2-18-15-9 17-6z"
            fill="#ffef91"
          />
          <rect x="88" y="62" width="13" height="22" rx="6" fill="#fff5e3" />
          <path d="M85 76q0 13 10 13t10-13M95 89v10" />
          <path d="M36 81h36m-36 7h23" strokeWidth="3" />
          <path
            d="m32 6 19-2 2 11-19 2m48-11 19 1-1 11-19-1"
            fill="#b7a5f8"
            strokeWidth="2"
          />
        </>
      )}
    </svg>
  );
}
