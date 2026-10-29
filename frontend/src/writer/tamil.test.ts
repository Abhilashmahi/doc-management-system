import { describe, expect, it } from 'vitest';
import { fixPastedText, isBaminiFont } from './tamil';

describe('pasting Tamil', () => {
  it('fixes pasted Bamini lines and leaves English alone', () => {
    expect(fixPastedText('mDg;Geh;\nSurvey number 720/1\nMidkiy tl;lk;>')).toBe('அனுப்புநர்\nSurvey number 720/1\nஆனைமலை வட்டம்,');
  });

  it('knows the old Tamil font names', () => {
    expect(isBaminiFont('Sun-TommyTamilNormal')).toBe(true);
    expect(isBaminiFont('Bamini')).toBe(true);
    expect(isBaminiFont('Nirmala UI')).toBe(false);
  });
});
