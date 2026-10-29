import { describe, expect, it } from 'vitest';
import { baminiToUnicode, looksLikeBamini, repairTamilOrder, unicodeToBamini } from './bamini';

// Lines taken from a real Bamini-font petition (the raw text PDF.js reads) and what they say in Tamil.
const SAMPLES: [string, string][] = [
  ['mDg;Geh;', 'அனுப்புநர்'],
  ['godhj;jhs; f/ng rpd;dg;gd;>', 'பழனாத்தாள் க/பெ சின்னப்பன்,'],
  ['5/1> khupag;gfTz;lh; tPjp>', '5/1, மாரியப்பகவுண்டர் வீதி,'],
  ['Nfhl;^h; kiyahz;bgl;bzk;>', 'கோட்டூர் மலையாண்டிபட்டிணம்,'],
  ['Midkiy(t)> Nfhak;Gj;J}h;-642114', 'ஆனைமலை(வ), கோயம்புத்தூர்-642114'],
  ['ifNgrp vz;: 9344286331', 'கைபேசி எண்: 9344286331'],
  ['nghUs;: vdf;F nrhe;jkhd tPl;Lkid ,lj;jpw;F vdJ ngaupy; gl;lh', 'பொருள்: எனக்கு சொந்தமான வீட்டுமனை இடத்திற்கு எனது பெயரில் பட்டா'],
  ['Iah> ehd; Nkw;fz;l Kftupapy; trpj;J tUfpNwd;.', 'ஐயா, நான் மேற்கண்ட முகவரியில் வசித்து வருகிறேன்.'],
];

describe('Bamini to Unicode', () => {
  it.each(SAMPLES)('converts %s', (bamini, tamil) => {
    expect(baminiToUnicode(bamini).normalize('NFC')).toBe(tamil.normalize('NFC'));
  });

  it('joins the two-part vowels ொ ோ ௌ', () => {
    expect(baminiToUnicode('nfh')).toBe('கொ');
    expect(baminiToUnicode('Nfh')).toBe('கோ');
    expect(baminiToUnicode('nfs')).toBe('கௌ');
    expect(baminiToUnicode('nts;is')).toBe('வெள்ளை'); // ள் is not ௌ
  });

  it('tells Bamini text from English', () => {
    expect(looksLikeBamini(SAMPLES.map(([b]) => b).join(' '))).toBe(true);
    expect(looksLikeBamini('Survey number 720/1, Coimbatore district; patta transfer request')).toBe(false);
    expect(looksLikeBamini('அனுப்புநர்')).toBe(false);
  });
});

describe('Unicode to Bamini', () => {
  it.each(SAMPLES)('turns %s back into the same keys', (bamini, tamil) => {
    expect(baminiToUnicode(unicodeToBamini(tamil)).normalize('NFC')).toBe(tamil.normalize('NFC'));
  });

  it('writes the keys a Bamini typist uses', () => {
    expect(unicodeToBamini('அனுப்புநர்')).toBe('mDg;Geh;');
    expect(unicodeToBamini('கோட்டூர்')).toBe('Nfhl;^h;');
    expect(unicodeToBamini('வெள்ளை')).toBe('nts;is');
  });
});

describe('Tamil copied from browser-made PDFs', () => {
  it('moves vowel signs back after their letter', () => {
    expect(repairTamilOrder('ேகாட்டூர் மைலயாண்டிபட்டிணம்')).toBe('கோட்டூர் மலையாண்டிபட்டிணம்');
    expect(repairTamilOrder('ஆைனமைல(வ), ேகாயம்புத்தூர்')).toBe('ஆனைமலை(வ), கோயம்புத்தூர்');
    expect(repairTamilOrder('ைகேபசி ெபறுநர்')).toBe('கைபேசி பெறுநர்');
    expect(repairTamilOrder('அனுப்புநர் கோட்டூர்')).toBe('அனுப்புநர் கோட்டூர்');
  });
});
