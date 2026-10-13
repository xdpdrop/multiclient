import mermaid from 'mermaid';

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  maxTextSize: 100000,
  maxEdges: 500,
  suppressErrorRendering: true,
  secure: [
    'secure',
    'securityLevel',
    'startOnLoad',
    'maxTextSize',
    'maxEdges',
    'htmlLabels',
    'suppressErrorRendering',
  ],
});
(window as any).renderArtifactDiagram = async (source: string) => {
  if (new TextEncoder().encode(source).length > 100000 || /%%\s*\{|^\s*---/m.test(source))
    throw new Error(
      'Diagram source exceeds its limit or attempts to override preview configuration.',
    );
  const result = await mermaid.render('artifact-diagram', source);
  return result.svg;
};
