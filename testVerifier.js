const { verifyRelease, verifyReleasesBatch } = require('./src/services/releaseVerifier');

async function runTests() {
  console.log("============================================================");
  console.log("🧪 TESTING TWO-STAGE RELEASE VERIFIER");
  console.log("Target Regions: AU, NZ, IE | Release Window: 14 Days");
  console.log("============================================================\n");

  const todayStr = new Date().toISOString().slice(0, 10);
  const threeDaysAgoStr = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const testCases = [
    {
      label: "Test 1: Clear AU Release (Triple J Unearthed)",
      item: {
        title: "Royel Otis - Heading For The Door",
        channel: "Triple J Unearthed",
        url: "https://www.abc.net.au/triplejunearthed/artist/royel-otis/",
        uploadedAt: threeDaysAgoStr,
        description: "Fresh indie surf release from Sydney duo."
      },
      expectPass: true,
      expectedStage: "deterministic"
    },
    {
      label: "Test 2: Reissue / Anniversary Catalog Cut",
      item: {
        title: "The Church - Under the Milky Way (20th Anniversary Remaster)",
        channel: "YouTube",
        url: "https://youtube.com/watch?v=mock123",
        uploadedAt: todayStr,
        description: "Remastered edition from 1988 classic album."
      },
      expectPass: false,
      expectedStage: "deterministic"
    },
    {
      label: "Test 3: Non-Target International Band (UK Act)",
      item: {
        title: "The 1975 - Happiness",
        channel: "Blogs",
        url: "https://example.com/the-1975",
        uploadedAt: threeDaysAgoStr,
        description: "Manchester pop rock quartet return with new track."
      },
      expectPass: false
    },
    {
      label: "Test 4: Ambiguous AU Act on Open-Web Blog (needs Stage 2 lookup)",
      item: {
        title: "Amyl and the Sniffers - U Should Not Be Doing That",
        channel: "Blogs",
        url: "https://example.com/amyl-sniffers",
        uploadedAt: threeDaysAgoStr,
        description: "Melbourne pub punk outfit drops high-energy cut."
      },
      expectPass: false
    },
    {
      label: "Test 5: Brand New Genuine NZ Single (The Beths from Auckland)",
      item: {
        title: "The Beths - Brand New Single Oct 2026",
        channel: "Blogs",
        url: "https://bandcamp.com/the-beths-new-track",
        uploadedAt: todayStr,
        description: "Auckland indie rockers premiere fresh new track today on Bandcamp."
      },
      expectPass: true
    }
  ];

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`------------------------------------------------------------`);
    console.log(`▶ ${tc.label}`);
    console.log(`  Input: "${tc.item.title}" [Channel: ${tc.item.channel}]`);

    const result = await verifyRelease(tc.item, {
      targetRegions: ['AU', 'NZ', 'IE'],
      releaseWindowDays: 14
    });

    console.log(`  Result isVerified:      ${result.isVerified ? '✅ TRUE' : '❌ FALSE'}`);
    console.log(`  Stage:                  ${result.verification.verification_stage}`);
    console.log(`  Country Code:           ${result.verification.country_code}`);
    console.log(`  Verified Origin:        ${result.verification.verified_origin}`);
    console.log(`  Verified New Release:   ${result.verification.verified_new_release}`);
    console.log(`  Note:                   ${result.verification.confidence_note}`);
    console.log('');
  }

  console.log("============================================================");
  console.log("🎉 Test run complete!");
  console.log("============================================================");
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
