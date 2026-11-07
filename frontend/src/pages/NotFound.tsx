import { Link } from "react-router-dom";
import { PageTitle } from "../components/ui";

export default function NotFound() {
  return (
    <>
      <PageTitle title="Page not found" sub="That page doesn't exist." />
      <Link to="/" className="text-gold-400 underline">Go to the start page</Link>
    </>
  );
}
