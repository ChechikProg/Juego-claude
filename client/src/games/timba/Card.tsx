import type { Card as CardT } from '@shared/types';

const SUIT_GLYPH: Record<CardT['s'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export function PlayingCard({
  card,
  index = 0,
  small,
}: {
  card: CardT;
  index?: number;
  small?: boolean;
}): JSX.Element {
  const red = card.s === 'H' || card.s === 'D';

  if (card.hidden) {
    return (
      <div
        className={`pc pc--back ${small ? 'pc--sm' : ''}`}
        style={{ animationDelay: `${index * 90}ms` }}
        aria-label="Carta tapada"
      >
        <span className="pc__pattern" aria-hidden />
      </div>
    );
  }

  return (
    <div
      className={`pc ${red ? 'pc--red' : ''} ${small ? 'pc--sm' : ''}`}
      style={{ animationDelay: `${index * 90}ms` }}
      aria-label={`${card.r} de ${SUIT_GLYPH[card.s]}`}
    >
      <span className="pc__corner pc__corner--tl">
        <b>{card.r}</b>
        <i>{SUIT_GLYPH[card.s]}</i>
      </span>
      <span className="pc__pip">{SUIT_GLYPH[card.s]}</span>
      <span className="pc__corner pc__corner--br">
        <b>{card.r}</b>
        <i>{SUIT_GLYPH[card.s]}</i>
      </span>
    </div>
  );
}

export function CardRow({ cards, small }: { cards: CardT[]; small?: boolean }): JSX.Element {
  return (
    <div className={`pc-row ${small ? 'pc-row--sm' : ''}`}>
      {cards.map((c, i) => (
        <PlayingCard key={`${i}-${c.r}-${c.s}-${c.hidden ? 'h' : 'v'}`} card={c} index={i} small={small} />
      ))}
    </div>
  );
}
