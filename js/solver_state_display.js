const {
  deferUntilAnimationFrame,
  dynamicJSFileLoader,
  formatNumberMetric,
  formatTimeMs,
  camelCaseToWords,
  clearDOMNode,
} = await import('./util.js' + self.VERSION_PARAM);

const { CollapsibleContainer } = await import('./constraint_input.js' + self.VERSION_PARAM);

export class SolverStateDisplay {
  constructor(solutionDisplay) {
    this._solutionDisplay = solutionDisplay;

    this._elements = {
      progressContainer: document.getElementById('progress-container'),
      stateOutput: document.getElementById('state-output'),
      progressBar: document.getElementById('solve-progress'),
      progressPercentage: document.getElementById('solve-percentage'),
      solveStatus: document.getElementById('solve-status'),
    };

    this._setUpStateOutput();
    this._stateHistory = new StateHistoryDisplay();
    this._isEstimateMode = false;

    this._lazyUpdateState = deferUntilAnimationFrame(
      this._lazyUpdateState.bind(this));
  }

  _lazyUpdateState(state) {
    this._displayStateVariables(state);

    this._updateProgressBar(state);
  }

  _METHOD_TO_STATUS = {
    'solveAllPossibilities': 'Solving',
    'nthSolution': 'Solving',
    'nthStep': '',
    'countSolutions': 'Counting',
    'validateLayout': 'Validating',
    'terminate': 'Aborted',
    'estimatedCountSolutions': 'Estimating',
  };

  setSolveStatus(isSolving, method) {
    if (!isSolving && method == 'terminate') {
      this._elements.solveStatus.textContent = this._METHOD_TO_STATUS[method];
      this._elements.progressContainer.classList.add('solver-status-error');
      return;
    }

    if (isSolving) {
      this._elements.solveStatus.textContent = this._METHOD_TO_STATUS[method];
      this._elements.progressPercentage.style.display =
        this._isEstimateMode ? 'none' : 'inline';
      this._elements.solveStatus.textContent = '';
    }
    this._elements.progressContainer.classList.remove('solver-status-error');
  }

  setState(state) {
    this._lazyUpdateState(state);
    // Don't update state history lazily, as that will cause gaps when
    // the window is not active.
    this._stateHistory.add(state);
  }

  setEstimateMode(isEstimateMode) {
    this._isEstimateMode = isEstimateMode;
    this._stateHistory.setEstimateMode(isEstimateMode);
    this._stateVars['estimatedSolutions'].parentNode.style.display =
      isEstimateMode ? 'block' : 'none';
    this._stateVars['estimateSamples'].parentNode.style.display =
      isEstimateMode ? 'block' : 'none';
    this._stateVars['searchSpaceExplored'].parentNode.style.display =
      isEstimateMode ? 'none' : 'block';
    this._stateVars['solutions'].parentNode.style.display =
      isEstimateMode ? 'none' : 'block';
    this._elements.progressPercentage.style.display =
      isEstimateMode ? 'none' : 'inline';
  }

  clear() {
    for (const v in this._stateVars) {
      this._stateVars[v].textContent = '';
    }
    this._elements.progressBar.setAttribute('value', 0);
    this._elements.progressPercentage.textContent = '';
    this.setSolveStatus(false, '');
    this._elements.solveStatus.textContent = '';
    this._stateHistory.clear();
  }

  _displayStateVariables(state) {
    const counters = state.counters;
    const searchComplete = state.done && !counters.branchesIgnored;

    for (const v in this._stateVars) {
      let text;
      switch (v) {
        case 'solutions':
          this._renderNumberWithGaps(this._stateVars[v], counters[v]);
          if (!searchComplete) {
            this._stateVars[v].appendChild(
              document.createTextNode('+'));
          }
          break;
        case 'estimatedSolutions':
          if (state.extra?.estimate) {
            this._renderSolutionEstimate(
              this._stateVars[v], state.extra.estimate.solutions, searchComplete);
          }
          break;
        case 'estimateSamples':
          if (state.extra?.estimate) {
            this._renderNumberWithGaps(
              this._stateVars[v], state.extra.estimate.samples);
          }
          break;
        case 'puzzleSetupTime':
          text = state.puzzleSetupTime ? formatTimeMs(state.puzzleSetupTime) : '?';
          this._stateVars[v].textContent = text;
          break;
        case 'runtime':
          text = formatTimeMs(state.timeMs);
          this._stateVars[v].textContent = text;
          break;
        case 'searchSpaceExplored':
          if (!state.extra?.estimate) {
            text = (counters.progressRatio * 100).toPrecision(3) + '%';
            if (searchComplete) text = '100%';
            this._stateVars[v].textContent = text;
          }
          break;
        default:
          this._renderNumberWithGaps(this._stateVars[v], counters[v]);
      }
    }
  }

  _renderSolutionEstimate(container, estimatedSolutions, searchComplete) {
    // Round the estimate, but we know it must be at least 1 if it is non-zero.
    let intEstimate = Math.round(estimatedSolutions);
    if (intEstimate === 0 && estimatedSolutions > 0) intEstimate = 1;

    if (intEstimate < 1e6) {
      this._renderNumberWithGaps(container, intEstimate);
    } else {
      const exponent = Math.floor(Math.log10(intEstimate));
      const mantissa = intEstimate / Math.pow(10, exponent);
      clearDOMNode(container);
      container.appendChild(
        document.createTextNode(mantissa.toFixed(3) + '×10'));
      const sup = document.createElement('sup');
      sup.textContent = exponent;
      container.appendChild(sup);
    }

    // If we haven't found all the solutions, then show a ~ to indicate
    // that this is an estimate.
    if (!searchComplete) {
      container.insertBefore(
        document.createTextNode('~'), container.firstChild);
    }
  }

  _TEMPLATE_GAP_SPAN = (() => {
    const span = document.createElement('span');
    span.classList.add('number-gap');
    return span;
  })();

  _renderNumberWithGaps(container, number) {
    clearDOMNode(container);
    const numberStr = number.toString();

    let index = (numberStr.length % 3) || 3;
    container.appendChild(document.createTextNode(
      numberStr.substring(0, index)));
    while (index < numberStr.length) {
      container.appendChild(this._TEMPLATE_GAP_SPAN.cloneNode());
      container.appendChild(document.createTextNode(
        numberStr.substring(index, index + 3)));
      index += 3;
    }
  }

  _updateProgressBar(state) {
    const progress = state.done
      ? 1
      : state.counters.progressRatio + state.counters.branchesIgnored;
    const percent = Math.round(progress * 100);
    if (!this._isEstimateMode) {
      this._elements.progressBar.setAttribute('value', progress);
      this._elements.progressPercentage.textContent = percent + '%';
    }
  }

  _setUpStateOutput() {
    let container = this._elements.stateOutput;
    let vars = [
      'solutions',
      'estimatedSolutions',
      'estimateSamples',
      'guesses',
      'valuesTried',
      'constraintsProcessed',
      'searchSpaceExplored',
      'puzzleSetupTime',
      'runtime',
    ];
    this._stateVars = {};
    for (const v of vars) {
      let elem = document.createElement('div');
      let value = document.createElement('span');
      let title = document.createElement('span');
      title.textContent = camelCaseToWords(v);
      title.className = 'description';
      if (v == 'solutions' || v == 'estimatedSolutions') {
        title.style.fontSize = '16px';
      }
      // if (v == 'estimatedSolutions' || v == 'estimateSamples') {
      //   elem.style.display = 'none';
      // }
      elem.appendChild(value);
      elem.appendChild(title);
      container.appendChild(elem);

      this._stateVars[v] = value;
    }
  }
}

class StateHistoryDisplay {
  CHART_HEIGHT = 120;
  AXIS_WIDTH = 50;
  MAX_NUM_STATES = 1000;

  constructor() {
    this._states = [];
    this._statsContainer = null;
    this._statsInitPromise = null;
    this._visible = false;
    this._isEstimateMode = false;

    this._setUpChartToggle();
    this._charts = [];

    this._updateCharts = deferUntilAnimationFrame(
      this._updateCharts.bind(this));

    this.clear();
  }

  add(state) {
    const estimate = state.extra?.estimate;
    const newState = {
      timeMs: state.timeMs / 1000,
      guesses: state.counters.guesses,
      searchedPercentage: state.counters.progressRatio * 100,
      skippedPercentage: state.counters.branchesIgnored * 100,
      solutions: state.counters.solutions,
      estimatedSolutions: estimate ? estimate.solutions : 0,
      estimationSamples: estimate ? estimate.samples : 0,
    };

    if (this._states.length && newState.timeMs < this._nextT) {
      // If the new state is too soon then just update last point.
      this._states[this._states.length - 1] = newState;
    } else {
      // The new state is sufficiently new, so add a new data point.
      this._states.push(newState);
      this._nextT += this._deltaT;
    }

    // NOTE: Both of these defer work until it needs to be done.
    this._compressStates(this._states);
    this._updateCharts();
  }

  setEstimateMode(isEstimateMode) {
    this._isEstimateMode = isEstimateMode;
    for (const chart of this._charts) {
      const chartContainer = chart.canvas.parentNode.parentNode;
      const yAxis = chart.data.datasets[0].label;
      switch (yAxis) {
        case 'estimatedSolutions':
          chartContainer.style.display = isEstimateMode ? 'block' : 'none';
          break;
        case 'solutions':
        case 'searchedPercentage':
          chartContainer.style.display = isEstimateMode ? 'none' : 'block';
          break;
      }
    }
    this._updateCharts();
  }

  _compressStates(states) {
    if (states.length <= this.MAX_NUM_STATES) return;

    // Figure out the minimum time delta between states.
    const targetCount = this.MAX_NUM_STATES / 2;
    const deltaT = states[states.length - 1].timeMs / targetCount;

    // Remove states which are too close together.
    let j = 0;
    let nextT = 0;
    for (let i = 0; i < states.length - 1; i++) {
      const state = states[i];
      if (state.timeMs >= nextT) {
        nextT += deltaT;
        states[j++] = state;
      }
    }

    // Always include the last state.
    states[j++] = states[states.length - 1];

    // Truncate the states.
    states.length = j;

    // Update the global deltaT and nextT.
    this._deltaT = deltaT;
    this._nextT = nextT;
  }

  _updateCharts() {
    if (!this._visible || !this._charts.length) {
      return;
    }

    this._eventReplayFn();
    for (const chart of this._charts) {
      if (chart.canvas.offsetParent !== null) chart.update('none');
    }
  }

  clear() {
    this._deltaT = 0;
    this._nextT = 0;
    // NOTE: _states must be updated in place since we have passed it into the
    //       chart.
    this._states.length = 0;
  }

  _setUpChartToggle() {
    const toggle = document.getElementById('show-stats-charts-input');

    const setVisible = async (visible) => {
      if (!visible) {
        if (this._statsContainer) this._statsContainer.style.display = 'none';
        this._visible = false;
        return;
      }

      // Show the container immediately (anchor + loading notice) while the
      // charts load.
      this._statsContainer ||= document.getElementById('stats-container');
      this._statsContainer.style.display = 'block';
      this._visible = true;

      await this._initStatsContainer();

      this._updateCharts();
    };

    toggle.onchange = () => {
      setVisible(toggle.checked);
    };
  }

  static _openAndPositionContainer(container) {
    container.style.top = ((window.innerHeight / 2) - (container.offsetHeight / 2)) + 'px';
    container.style.left = ((window.innerWidth / 2) - (container.offsetWidth / 2)) + 'px';
    container.style.display = 'block';
  }

  async _initStatsContainer() {
    if (this._statsInitPromise) return this._statsInitPromise;

    this._statsContainer ||= document.getElementById('stats-container');
    const container = this._statsContainer;
    const collapsible = new CollapsibleContainer(
      container,
          /* defaultOpen= */ true);

    this._statsInitPromise = (async () => {
      try {
        await dynamicJSFileLoader('lib/chart.umd.min.js')();

        collapsible.toggleOpen(true);
        const statsBody = collapsible.bodyElement();
        clearDOMNode(statsBody);

        this._addChartDisplay(statsBody,
          'Solutions', 'solutions');
        this._addChartDisplay(statsBody,
          'Estimated solutions', 'estimatedSolutions');
        this._addChartDisplay(statsBody,
          'Progress percentage (searched + skipped)',
          'searchedPercentage', 'skippedPercentage');
        this._addChartDisplay(statsBody,
          'Guesses', 'guesses');

        this._eventReplayFn = this._syncToolTips(this._charts);

        this.setEstimateMode(this._isEstimateMode);
        container.classList.add('lazy-loaded');
      } catch (e) {
        const loadingElement = container.querySelector('.lazy-loading');
        loadingElement.textContent = `Failed to load charts: ${e.message}`;
        loadingElement.classList.remove('notice-info');
        loadingElement.classList.add('notice-error');
      }
    })();

    return this._statsInitPromise;
  }

  _addChartDisplay(container, title, ...yAxis) {
    const chartContainer = document.createElement('div');
    container.appendChild(chartContainer);

    const titleElem = document.createElement('div');
    titleElem.classList.add('description');
    titleElem.textContent = title;
    chartContainer.appendChild(titleElem);

    const canvasContainer = document.createElement('div');
    canvasContainer.style.height = this.CHART_HEIGHT;
    chartContainer.appendChild(canvasContainer);

    const ctx = document.createElement('canvas');
    canvasContainer.appendChild(ctx);
    this._makeChart(ctx, ...yAxis);
    return canvasContainer;
  }

  _makeChart(ctx, ...yAxis) {
    const options = {
      events: [], // We will manually implement hover.
      normalized: true,
      responsive: true,
      maintainAspectRatio: false,
      pointRadius: 0,
      animation: false,
      parsing: {
        xAxisKey: 'timeMs',
      },
      elements: {
        line: { borderWidth: 1 },
      },
      scales: {
        x: {
          type: 'linear',
          grace: 0,
          beginAtZero: true,
          ticks: {
            font: { size: 10 },
            callback: function (...args) {
              // Use function so that `this` is bound.
              return Chart.Ticks.formatters.numeric.apply(this, args) + 's';
            }
          },
        },
        y: {
          stacked: true,
          afterFit: (axis) => { axis.width = this.AXIS_WIDTH; },
          beginAtZero: true,
          ticks: {
            font: { size: 10 },
            callback: formatNumberMetric,
          }
        }
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label: StateHistoryDisplay._formatTooltipLabel,
          }
        },
      }
    };
    const data = {
      datasets: yAxis.map((key) => ({
        label: key,
        data: this._states,
        stepped: true,
        parsing: {
          yAxisKey: key,
        },
      }))
    };
    const config = {
      type: 'line',
      data: data,
      options: options,
    };

    const chart = new Chart(ctx, config);
    this._charts.push(chart);
    return chart;
  }

  static _formatTooltipLabel(context) {
    const label = context.dataset.label || '';
    const value = context.parsed.y;
    const formattedValue = (value > 0 && (value < 0.001 || value > 1e6))
      ? value.toExponential(3)
      : value.toLocaleString();
    return `${label}: ${formattedValue}`;
  }

  _syncToolTips(charts) {
    let currentIndex = -1;
    let lastCall = null;

    const onMouseMove = (e, currentChart) => {
      lastCall = [e, currentChart];

      // Find the nearest points.
      const points = currentChart.getElementsAtEventForMode(
        e, 'index', { intersect: false }, true);

      // If it is the currently active index, then nothing needs to change.
      const index = points.length ? points[0].index : -1;
      if (index == currentIndex) return;

      // Update the active elements for all the charts.
      currentIndex = index;
      for (const chart of charts) {
        if (chart.canvas.offsetParent === null) continue;
        const activeElements = [];
        if (points.length) {
          const numDatasets = chart.data.datasets.length;
          for (let i = 0; i < numDatasets; i++) {
            activeElements.push({
              index: index,
              datasetIndex: i,
            });
          }
        }
        chart.tooltip.setActiveElements(activeElements);
        chart.setActiveElements(activeElements);
        chart.render();
      }
    };

    // Setup all charts.
    for (const chart of charts) {
      chart.canvas.onmousemove = e => onMouseMove(e, chart);
    }

    // Pass back a function that will allow us to replay the last call.
    // This is used when the chart is updated to ensure the tooltip is updated
    // if the point under the mouse changes.
    return () => { lastCall && onMouseMove(...lastCall); };
  }
}
