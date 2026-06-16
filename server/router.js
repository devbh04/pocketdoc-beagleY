// Complexity Router: local vs delegated inference decision

export function routeQuery(text, imageBase64) {
  // 1. Vision check: MedPsy-1.7B is text-only. If an image is present, always delegate to laptop.
  if (imageBase64) {
    return {
      mode: 'delegated',
      reason: 'Query contains symptom image (multimodal requires laptop compute)'
    };
  }

  if (!text || text.trim() === '') {
    return {
      mode: 'local',
      reason: 'Empty or trivial query'
    };
  }

  let score = 0;

  // 2. Word Count check: Longer prompts indicate higher complexity
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount > 100) {
    score += 4;
  } else if (wordCount > 50) {
    score += 2;
  }

  // 3. Clinical Complexity Keyword Check
  // Keywords indicating potentially critical/complex issues requiring a larger model (4B/7B)
  const complexKeywords = [
    'chest pain', 'heart attack', 'difficulty breathing', 'shortness of breath',
    'stroke', 'drooping', 'paralysis', 'seizure', 'unconscious', 'poison',
    'severe bleeding', 'fracture', 'anaphylaxis', 'choking', 'cpr',
    'stiff neck', 'confusion', 'diabetes', 'arrhythmia', 'sepsis'
  ];

  const lowerText = text.toLowerCase();
  for (const keyword of complexKeywords) {
    if (lowerText.includes(keyword)) {
      score += 3;
    }
  }

  // Complexity Threshold: 5 points
  if (score >= 5) {
    return {
      mode: 'delegated',
      reason: `High clinical complexity score (${score} >= 5)`
    };
  }

  return {
    mode: 'local',
    reason: `Low complexity score (${score} < 5)`
  };
}
