import runtime from 'sharp';
import type factory from '../node_modules/sharp/lib/index';

// vinext declares the optional "sharp" module as unknown. Use the explicitly
// installed package's own declarations while loading its normal runtime entry.
export const sharp = runtime as typeof factory;
