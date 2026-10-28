// Web build of ChartModal: react-native-wagmi-charts (+ d3) is loaded with
// import() the first time a chart is opened, so it is not in the entry bundle.
// The phone build uses ChartModal.tsx unchanged.
import React, { Suspense, lazy, useState } from 'react';

type Props = React.ComponentProps<typeof import('./ChartModalImpl').ChartModal>;

const LazyChartModal = lazy(() => import('./ChartModalImpl').then((m) => ({ default: m.ChartModal })));

export function ChartModal(props: Props) {
  // Mount (and download) only once a chart has been opened.
  const [opened, setOpened] = useState(props.visible);
  if (props.visible && !opened) setOpened(true);
  if (!opened) return null;
  return (
    <Suspense fallback={null}>
      <LazyChartModal {...props} />
    </Suspense>
  );
}
