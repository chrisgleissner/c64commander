const PROFILE_LOOPS = {
  smoke: {
    scenarios: 1,
    secondary: 3,
  },
  nightly: {
    scenarios: 3,
    secondary: 5,
  },
  'manual-extended': {
    scenarios: 5,
    secondary: 8,
  },
};

export const resolvePerfProfileName = ({ profile, useRealArchives }) => {
  if (profile === 'smoke' || profile === 'nightly' || profile === 'manual-extended') {
    return profile;
  }

  return useRealArchives ? 'nightly' : 'smoke';
};

export const resolveWebPerfRunProfile = ({ suite, useRealArchives, profile }) => {
  const resolvedProfile = resolvePerfProfileName({ profile, useRealArchives });
  const loops = PROFILE_LOOPS[resolvedProfile]?.[suite] ?? 1;

  if (suite === 'scenarios') {
    if (useRealArchives) {
      return {
        profile: resolvedProfile,
        loops,
        mode: 'hybrid-real-download-fixture-browse-web',
        evidenceClass: 'hybrid',
        supported: false,
        limitations: [
          'S1/S2 use real archive downloads, but S3-S11 still run against installReadyHvscMock fixture data.',
          'This run is not eligible to claim web T1-T5 closure; use the Android baseline for required-platform target evidence.',
        ],
      };
    }

    return {
      profile: resolvedProfile,
      loops,
      mode: 'fixture-s1-s11-web',
      evidenceClass: 'fixture',
      supported: true,
      limitations: ['Fixture web S1-S11 runs are mechanism proof only and must not be used to claim T1-T5 closure.'],
    };
  }

  if (useRealArchives) {
    return {
      profile: resolvedProfile,
      loops,
      mode: 'fixture-secondary-web',
      evidenceClass: 'fixture',
      supported: true,
      limitations: ['The secondary web suite uses installReadyHvscMock fixture data; real archive inputs are not exercised.'],
    };
  }

  return {
    profile: resolvedProfile,
    loops,
    mode: 'fixture-secondary-web',
    evidenceClass: 'fixture',
    supported: true,
    limitations: ['Fixture secondary web runs are mechanism proof only and must not be used to claim target closure.'],
  };
};
