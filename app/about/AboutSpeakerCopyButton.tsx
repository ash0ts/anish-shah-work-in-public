"use client";

import { useEffect, useRef, useState } from "react";

type AboutSpeakerCopyButtonProps = {
  className?: string;
  label: string;
  profileText: string;
  statusClassName?: string;
};

export function AboutSpeakerCopyButton({
  className,
  label,
  profileText,
  statusClassName,
}: AboutSpeakerCopyButtonProps) {
  const [status, setStatus] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.removeAttribute("hidden");
    const openLinkedProfile = () => {
      if (window.location.hash !== "#speaker-title") return;
      const details = document.getElementById("speaker-profile");
      if (details instanceof HTMLDetailsElement) details.open = true;
    };
    openLinkedProfile();
    window.addEventListener("hashchange", openLinkedProfile);
    return () => window.removeEventListener("hashchange", openLinkedProfile);
  }, []);

  async function copyProfile() {
    setStatus("");
    try {
      await navigator.clipboard.writeText(profileText);
      setStatus("Speaker profile copied.");
    } catch {
      const details = document.getElementById("speaker-profile");
      if (details instanceof HTMLDetailsElement) details.open = true;
      setStatus("Copy failed. Select the profile text instead.");
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        className={className}
        hidden
        onClick={copyProfile}
        type="button"
      >
        {label}
        <svg
          aria-hidden="true"
          fill="none"
          focusable="false"
          stroke="currentColor"
          strokeWidth="1.7"
          viewBox="0 0 20 20"
        >
          <rect height="10" rx="1" width="10" x="3" y="3" />
          <path d="M7 7h10v10H7z" />
        </svg>
      </button>
      <p
        aria-atomic="true"
        aria-live="polite"
        className={statusClassName}
        role="status"
      >
        {status}
      </p>
    </>
  );
}
