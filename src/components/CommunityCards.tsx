import {Board} from "../lib/rules";
import CardImage from "./CardImage";
import React from "react";

export default function CommunityCards(props: {
  board: Board;
}) {
  // The `key` flips from back→face the instant a card is revealed, remounting that one
  // slot so its CSS flip-in animation plays — the board "turns over" as it streets.
  return (
    <div className="community-cards">
      {[0, 1, 2, 3, 4].map((i) => (
        <CardImage
          key={props.board[i] ? `face-${i}` : `back-${i}`}
          card={props.board[i]}
          data-testid={`board-card-${i}`}
        />
      ))}
    </div>
  );
}
