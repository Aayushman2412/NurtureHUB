import React, { useRef, useState, useEffect } from 'react';

interface OTPInputProps {
  length?: number;
  onComplete: (code: string) => void;
}

const OTPInput: React.FC<OTPInputProps> = ({ length = 6, onComplete }) => {
  const [code, setCode] = useState<string[]>(new Array(length).fill(''));
  const inputsRef = useRef<HTMLInputElement[]>([]);

  useEffect(() => {
    // Focus first input on mount
    if (inputsRef.current[0]) {
      inputsRef.current[0].focus();
    }
  }, []);

  const handleChange = (value: string, index: number) => {
    // Ensure only digits are typed
    if (value && !/^\d$/.test(value)) return;

    const newCode = [...code];
    newCode[index] = value;
    setCode(newCode);

    // If filled, move to next input
    if (value && index < length - 1) {
      inputsRef.current[index + 1].focus();
    }

    // Trigger complete if all are filled
    const completedCode = newCode.join('');
    if (completedCode.length === length) {
      onComplete(completedCode);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace') {
      if (!code[index] && index > 0) {
        // Clear previous input and focus it
        const newCode = [...code];
        newCode[index - 1] = '';
        setCode(newCode);
        inputsRef.current[index - 1].focus();
      } else {
        // Clear current input
        const newCode = [...code];
        newCode[index] = '';
        setCode(newCode);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputsRef.current[index - 1].focus();
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      inputsRef.current[index + 1].focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData('text').trim();
    if (!/^\d+$/.test(pasteData)) return; // Only process digits

    const pastedDigits = pasteData.slice(0, length).split('');
    const newCode = [...code];

    for (let i = 0; i < length; i++) {
      if (pastedDigits[i]) {
        newCode[i] = pastedDigits[i];
      }
    }
    setCode(newCode);

    // Focus last filled or last input
    const focusIndex = Math.min(pastedDigits.length, length - 1);
    inputsRef.current[focusIndex]?.focus();

    const completedCode = newCode.join('');
    if (completedCode.length === length) {
      onComplete(completedCode);
    }
  };

  return (
    <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', margin: '24px 0' }}>
      {code.map((num, i) => (
        <input
          key={i}
          // @ts-ignore
          ref={(el) => (inputsRef.current[i] = el as HTMLInputElement)}
          type="text"
          maxLength={1}
          value={num}
          onChange={(e) => handleChange(e.target.value, i)}
          onKeyDown={(e) => handleKeyDown(e, i)}
          onPaste={handlePaste}
          style={{
            width: '48px',
            height: '56px',
            fontSize: '1.5rem',
            fontWeight: '700',
            textAlign: 'center',
            borderRadius: 'var(--radius-md)',
            border: '2px solid var(--border-color)',
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            boxShadow: 'var(--shadow-xs)',
            transition: 'border-color var(--transition-fast)'
          }}
          className="otp-field"
        />
      ))}
    </div>
  );
};

export default OTPInput;
