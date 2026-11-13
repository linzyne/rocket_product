import { useEffect, useMemo, useState } from 'react';
import { ShipOut, subscribeShipOuts } from '../coupangOrder/data/shipOutStore';
import { ReceiveRow, subscribeReceives } from '../../data/receiveStore';
import { ReturnMark, receiveStatusOf, subscribeReturns } from '../../data/returnStore';

// 메뉴의 발송완료 배지: 발송완료한 줄 중 입고예정일에서 며칠이 지나도 입고가 다 안 잡힌 줄 수(✕, 회송·분실 처리할 것).
export const useReturnAlertCount = () => {
  const [list, setList] = useState<ShipOut[]>([]);
  const [receives, setReceives] = useState<ReceiveRow[]>([]);
  const [marks, setMarks] = useState<Record<string, ReturnMark[]>>({});
  useEffect(() => subscribeShipOuts(setList), []);
  useEffect(() => subscribeReceives(setReceives), []);
  useEffect(() => subscribeReturns(setMarks), []);
  return useMemo(() => {
    let n = 0;
    receiveStatusOf(list.filter(i => !!i.sentDate), receives, marks).forEach(c => { if (c.overdue) n += 1; });
    return n;
  }, [list, receives, marks]);
};
