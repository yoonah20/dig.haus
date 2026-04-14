import { Router } from 'express';
import { getLabelInfo, getLabelReleases } from '../services/discogs.js';
import { getLabelByName } from '../services/musicbrainz.js';

const router = Router();

// GET /api/labels/:name - label detail by name
router.get('/:name', async (req, res) => {
  const { name } = req.params;

  try {
    const label = await getLabelInfo(decodeURIComponent(name));

    if (!label) {
      return res.status(404).json({ error: 'Label not found' });
    }

    let releases: any[] = [];
    try {
      releases = await getLabelReleases(label.id);
    } catch {
      // ignore
    }

    let foundingYear = label.foundingYear || '';
    let country = label.country || '';

    // Fallback to MusicBrainz for founding year
    if (!foundingYear) {
      try {
        const mbLabel = await getLabelByName(decodeURIComponent(name));
        if (mbLabel) {
          foundingYear = mbLabel.foundingYear || '';
          if (!country) country = mbLabel.country || '';
        }
      } catch {
        // ignore
      }
    }

    // Validate founding year
    const yearNum = parseInt(foundingYear, 10);
    const validYear = yearNum >= 1900 && yearNum <= new Date().getFullYear() ? foundingYear : null;

    res.json({
      label: {
        name: label.name,
        foundingYear: validYear,
        country: country || null,
        genreFocus: label.genreFocus || null,
      },
      releases: releases || [],
    });
  } catch (error) {
    console.error('Label detail error:', error);
    res.status(500).json({ error: 'Failed to fetch label details' });
  }
});

export default router;
