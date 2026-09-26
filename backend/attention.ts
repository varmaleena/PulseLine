// Narrow, transparent attention aid for explicit reported breathing distress.
// This is not a severity score or a diagnosis. Do not infer symptoms from questions.
export function reportedAttention(text:string):string|undefined {
 const value=text.toLowerCase().replace(/[’‘]/g,"'");
 if(/[?？]/.test(value)||/\b(no|without|not having|don't have|do not have)\b.{0,25}\b(difficulty|trouble|breathing problems)\b/.test(value))return;
 if(/\b(i|i'm|i am)\b.{0,20}\b(can't|cannot|unable to)\s+breathe\b/.test(value)
  ||/\bi\b.{0,35}\b(difficulty|trouble)\s+breathing\b/.test(value)
  ||/\bi\b.{0,25}\bstruggling to breathe\b/.test(value)
  ||/\b(it's|it is|it was)\s+(very |really |so )?(hard|difficult) for me to breathe\b/.test(value))return 'Reported breathing difficulty · confirm with patient';
}
