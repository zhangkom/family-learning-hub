/** The book and flame are shared with the native launcher artwork. */
export function BrandMark({ size = 38 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="18" fill="#315CED" />
      <path
        d="M34 9C36 17 43 19 43 25C43 31 38 34 32 34C26 34 21 30 21 25C21 21 24 17 28 14C27 20 29 23 31 24C35 21 36 16 34 9Z"
        fill="#FFBE70"
      />
      <path
        d="M12 34C19 32 25 33 32 37C39 33 45 32 52 34V51C45 49 39 50 32 54C25 50 19 49 12 51V34Z"
        fill="white"
      />
      <path
        d="M32 38V50"
        stroke="#315CED"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
