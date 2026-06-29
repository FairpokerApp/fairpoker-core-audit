import React, { HTMLAttributes } from 'react';
import {isStandardCard, StandardCard} from "../lib/secureMentalPoker";

export type CardImageProps = HTMLAttributes<HTMLDivElement> & {
  card?: StandardCard | null;
  alt?: string;
};

const SUIT_SYMBOLS: Record<StandardCard['suit'], string> = {
  Spade: '♠',
  Heart: '♥',
  Diamond: '♦',
  Club: '♣',
};

const RANK_LABELS: Record<StandardCard['rank'], string> = {
  A: 'A',
  K: 'K',
  Q: 'Q',
  J: 'J',
  T: '10',
  '9': '9',
  '8': '8',
  '7': '7',
  '6': '6',
  '5': '5',
  '4': '4',
  '3': '3',
  '2': '2',
};

export default function CardImage(props: CardImageProps) {
  if (!isStandardCard(props.card)) {
    const {
      alt,
      className,
      card: _card,
      ...otherAttributes
    } = props;
    return (
      <div
        className={className ? `card playing-card card-back ${className}` : 'card playing-card card-back'}
        role="img"
        aria-label={alt ?? 'Back'}
        {...otherAttributes}
      >
        <span className="card-back-frame" aria-hidden="true" />
        <span className="card-back-mark" aria-hidden="true">FP</span>
      </div>
    );
  }

  const {
    alt,
    className,
    card,
    ...otherAttributes
  } = props;

  const suit = SUIT_SYMBOLS[card.suit];
  const rank = RANK_LABELS[card.rank];
  const colorClass = card.suit === 'Heart' || card.suit === 'Diamond' ? 'red' : 'black';

  return (
    <div
      className={className ? `card playing-card ${colorClass} ${className}` : `card playing-card ${colorClass}`}
      role="img"
      aria-label={alt ?? `${card.suit}${card.rank}`}
      {...otherAttributes}
    >
      <span className="card-corner card-corner-top" aria-hidden="true">
        <b>{rank}</b>
        <i>{suit}</i>
      </span>
      <span className="card-center-suit" aria-hidden="true">{suit}</span>
      <span className="card-corner card-corner-bottom" aria-hidden="true">
        <b>{rank}</b>
        <i>{suit}</i>
      </span>
    </div>
  );
}
