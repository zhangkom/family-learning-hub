// Local synthetic QA entry only; never imported by the application.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FamilyApi } from '../../api';
import { CloudPhotoDrive } from '../CloudPhotoDrive';
declare global { interface Window { cloudFixture: { scope: (owner: string, student: string) => void; open: () => void } } }
function Fixture() {
  const [owner, setOwner] = useState('A'), [student, setStudent] = useState('a'), [closed, setClosed] = useState(false);
  const api = useMemo(() => new FamilyApi(location.origin + '/synthetic-api', owner), [owner]);
  window.cloudFixture = { scope: (nextOwner, nextStudent) => { setOwner(nextOwner); setStudent(nextStudent); }, open: () => setClosed(false) };
  return closed ? <button onClick={() => setClosed(false)}>重新打开云盘</button> : <CloudPhotoDrive api={api} owner={`${api.base}|${owner}`} studentId={student} studentLabel={`合成孩子 ${student.toUpperCase()}`} onClose={() => setClosed(true)} />;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
