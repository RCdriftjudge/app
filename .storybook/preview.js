import '../src/style.css'

export default {
  initialGlobals: { viewport: { value: 'mobile2', isRotated: false } },
  parameters: {
    layout: 'fullscreen',
    backgrounds: { disable: true },
    options: { storySort: { order: ['Overview', 'Landing', 'Director', 'Judge', 'Competitor', 'Live Display', 'Feedback'] } },
  },
}
