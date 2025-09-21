jest.mock('./ui/app.js', () => {
  const initMock = jest.fn();
  const AppMock = jest.fn(() => ({ init: initMock }));
  globalThis.__AppMock = AppMock;
  globalThis.__AppInitMock = initMock;
  return { App: AppMock };
});
jest.mock('./services/preprocess.js', () => ({ PreprocessService: jest.fn(() => ({})) }));
jest.mock('./services/estimation.js', () => ({ EstimationService: jest.fn(() => ({})) }));
jest.mock('./services/storage.js', () => ({ StorageService: jest.fn(() => ({})) }));

describe('index bootstrap', () => {
  test('constructs App and calls init on DOMContentLoaded', () => {
    let domHandler;
    const addEventListenerSpy = jest.spyOn(document, 'addEventListener').mockImplementation((event, handler) => {
      if (event === 'DOMContentLoaded') {
        domHandler = handler;
      }
    });
    global.fetch = jest.fn();

    jest.isolateModules(() => {
      require('./index.js');
    });

    domHandler();
    expect(globalThis.__AppMock).toHaveBeenCalledTimes(1);
    expect(globalThis.__AppInitMock).toHaveBeenCalled();

    addEventListenerSpy.mockRestore();
    delete global.fetch;
    delete globalThis.__AppMock;
    delete globalThis.__AppInitMock;
  });
});
