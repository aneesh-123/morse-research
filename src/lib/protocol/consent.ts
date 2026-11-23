/**
 * Versioned consent documents. The text is generated from the study contact settings so the
 * researcher's real details appear in it; nothing here invents a name, affiliation or approval.
 * The server stores a SHA-256 of the exact rendered document with each consent decision.
 */

export interface StudyContact {
  researcherName: string;
  contactEmail: string;
  /** Optional affiliation. Leave empty if there is none. */
  institution: string;
  /** Optional ethics statement, e.g. an approval reference. Leave empty unless approval exists. */
  ethicsStatement: string;
  /** How long research data is kept and what happens after. */
  dataRetention: string;
}

export interface ConsentSection { heading: string; body: string[] }
export interface ConsentDocument { version: string; title: string; sections: ConsentSection[]; agreeLabel: string; declineLabel: string }

export function contactConfigured(c: StudyContact): boolean {
  return c.researcherName.trim().length > 0 && /.+@.+\..+/.test(c.contactEmail.trim());
}

function contactLine(c: StudyContact): string {
  const who = c.institution.trim() ? `${c.researcherName.trim()} (${c.institution.trim()})` : c.researcherName.trim();
  return `Questions, withdrawal or deletion requests: ${who}, ${c.contactEmail.trim()}.`;
}

function ethicsLine(c: StudyContact): string {
  return c.ethicsStatement.trim()
    ? c.ethicsStatement.trim()
    : 'This is an independent research pilot. It has not been reviewed by an institutional ethics board.';
}

export function day1Consent(c: StudyContact): ConsentDocument {
  return {
    version: 'consent-v1',
    title: 'Before you start',
    sections: [
      {
        heading: 'What this study is about',
        body: [
          'We are studying how people learn to recognise Morse code by ear, and whether a computer can estimate what someone has learned from how they practise.',
        ],
      },
      {
        heading: 'What you will do',
        body: [
          'Listen to short beeps and pick the letter you hear. You will learn six letters with feedback, then take a short test without feedback.',
          'It takes about 15 to 20 minutes. Use headphones or your speaker in a quiet place. You must be 18 or older.',
        ],
      },
      {
        heading: 'What we record',
        body: [
          'Your answers, response times, how often you replay sounds, taps and clicks on the study buttons, counts of mouse and keyboard activity on the study page, when the page is hidden or loses focus, idle periods, and your device type and browser family.',
          'We do not record your microphone, anything you type outside the study controls, or your browsing history.',
        ],
      },
      {
        heading: 'How your data is stored',
        body: [
          'Your data is stored in a secured database linked to a random participant ID. Only the research team can see it. Your nickname and email (if given) are kept separately from research data and are not included in research exports.',
          c.dataRetention.trim(),
        ],
      },
      {
        heading: 'Your choices',
        body: [
          'Taking part is voluntary. You can stop at any time by leaving the page. You can delete your account and all of your data at any time from your home page.',
          contactLine(c),
          ethicsLine(c),
        ],
      },
    ],
    agreeLabel: 'I am 18 or older and I agree to take part',
    declineLabel: 'I do not want to take part',
  };
}

export function retentionConsent(c: StudyContact): ConsentDocument {
  return {
    version: 'consent-retention-v1',
    title: 'Follow-up check',
    sections: [
      {
        heading: 'What you will do',
        body: [
          'A short follow-up to your earlier session: listen to the six letters you learned and pick what you hear. There is no feedback and no replay. It takes about 3 to 5 minutes.',
          'We will first ask one question about whether you practised Morse code since your last session.',
        ],
      },
      {
        heading: 'What we record',
        body: [
          'The same kinds of data as last time: answers, response times, taps and clicks on study buttons, page visibility and focus changes, and device type. No microphone, typing outside the study, or browsing history.',
          c.dataRetention.trim(),
        ],
      },
      {
        heading: 'Your choices',
        body: ['Taking part is voluntary and you can delete all of your data at any time from your home page.', contactLine(c), ethicsLine(c)],
      },
    ],
    agreeLabel: 'I agree to take part in this follow-up',
    declineLabel: 'Not now',
  };
}

export function consentFor(version: string, c: StudyContact): ConsentDocument {
  if (version === 'consent-v1') return day1Consent(c);
  if (version === 'consent-retention-v1') return retentionConsent(c);
  throw new Error(`Unknown consent version ${version}`);
}
