import React, { ImgHTMLAttributes } from 'react';
import DataTestIdAttributes from "../lib/types";
import {useI18n} from "../lib/i18n";

export default function ChipImage(props: DataTestIdAttributes & ImgHTMLAttributes<HTMLImageElement>) {
  const {t} = useI18n();
  const {
    alt,
    className,
    'data-testid': dataTestId,
    ...otherAttributes
  } = props;
  return <img
    className={className ? `chip ${className}` : 'chip'}
    src={`${process.env.PUBLIC_URL}/chip.svg`}
    alt={alt ?? t('chipAlt')}
    data-testid={dataTestId ?? 'chip'}
    {...otherAttributes}
  />;
}
